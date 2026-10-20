/// <reference lib="webworker" />
// Whisper in a Web Worker (transformers.js): transcription never blocks the page.
//
// in:  {type:'load', modelsUrl, overrides?}  load once: WebGPU when an adapter exists, else WASM
//      {type:'run', id, pcm: Float32Array}       16 kHz mono, <= 30 s
// out: {type:'progress', loaded, total}          bytes over every model file seen so far
//      {type:'ready', device, model, detail, ms}
//      {type:'result', id, text, ms}
//      {type:'error', id?, message}
//
// Model files come from `modelsUrl` (the server's /models/, filled by server/fetch-models.sh) and
// fall back to the Hugging Face hub when a file is missing there. The ONNX Runtime WebAssembly
// binary is part of the studio build (an asset next to this worker), not fetched from a CDN.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

declare const self: DedicatedWorkerGlobalScope

/** Overrides for tuning (localStorage 'razzle-asr', see engine.ts): a device ('webgpu' | 'wasm', or
 *  per file, e.g. {encoder_model: 'webgpu', decoder_model_merged: 'wasm'}) and dtypes per file. */
export interface AsrOverrides {
	device?: string | Record<string, string>
	dtype?: Record<string, string>
	model?: string
}

/** The Whisper export per device: base.en where WebGPU runs it in ~0.4-0.8 s, tiny.en on the CPU
 *  (base.en takes ~4 s a call there). server/fetch-models.sh downloads both. */
export const ASR_MODELS = { webgpu: 'onnx-community/whisper-base.en', wasm: 'onnx-community/whisper-tiny.en' } as const

type In = { type: 'load'; modelsUrl: string; overrides?: AsrOverrides } | { type: 'run'; id: number; pcm: Float32Array }

let asr: AutomaticSpeechRecognitionPipeline | null = null
let loading: Promise<void> | null = null

const post = (msg: unknown, transfer: Transferable[] = []) => self.postMessage(msg, transfer)

async function load(modelsUrl: string, overrides: AsrOverrides = {}) {
	const t0 = performance.now()
	env.allowLocalModels = true
	env.allowRemoteModels = true
	env.localModelPath = modelsUrl
	env.useBrowserCache = true

	// transformers.js points ONNX Runtime at jsDelivr; unset, it loads the binary the bundler emitted
	const onnx = env.backends.onnx as any
	if (onnx?.wasm) onnx.wasm.wasmPaths = undefined

	let adapter: any = null
	try {
		if (overrides.device !== 'wasm') adapter = await (navigator as any).gpu?.requestAdapter()
	} catch {
		adapter = null
	}
	const device = overrides.device ?? (adapter ? 'webgpu' : 'wasm')
	const onGpu = (file: string) => (typeof device === 'string' ? device : device[file]) === 'webgpu'
	const label = typeof device === 'string' ? device : Object.values(device).includes('webgpu') ? 'webgpu' : 'wasm'
	const model = overrides.model ?? ASR_MODELS[label === 'webgpu' ? 'webgpu' : 'wasm']
	// WebGPU: half-precision encoder where the GPU has f16 shaders (else full), 4-bit decoder;
	// 4-bit encoders lose accuracy. WASM: 8-bit, the CPU's fast path.
	const f16 = !!adapter?.features?.has('shader-f16')
	const dtype = overrides.dtype ?? {
		encoder_model: onGpu('encoder_model') ? (f16 ? 'fp16' : 'fp32') : 'q8',
		decoder_model_merged: onGpu('decoder_model_merged') ? 'q4' : 'q8',
	}

	const files = new Map<string, { loaded: number; total: number }>()
	const progress_callback = (p: any) => {
		if (p.status !== 'progress' || !p.file) return
		files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 })
		let loaded = 0
		let total = 0
		for (const f of files.values()) {
			loaded += f.loaded
			total += f.total
		}
		post({ type: 'progress', loaded, total })
	}

	asr = (await (pipeline as any)('automatic-speech-recognition', model, { device, dtype, progress_callback })) as AutomaticSpeechRecognitionPipeline
	// first run compiles the kernels (WebGPU shaders); do it before real speech arrives
	await asr(new Float32Array(16000), { max_new_tokens: 4 } as any)
	post({ type: 'ready', device: label, model, detail: JSON.stringify({ device, dtype }), ms: Math.round(performance.now() - t0) })
}

self.onmessage = (ev: MessageEvent<In>) => {
	const msg = ev.data
	if (msg.type === 'load') {
		loading ??= load(msg.modelsUrl, msg.overrides).catch((e) => {
			loading = null
			post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
		})
	} else if (msg.type === 'run') queue = queue.then(() => run(msg))
}

// one transcription at a time, in arrival order
let queue: Promise<void> = Promise.resolve()

async function run(msg: Extract<In, { type: 'run' }>) {
	try {
		await loading
		if (!asr) throw new Error('model not loaded')
		const t0 = performance.now()
		const out = (await asr(msg.pcm, { max_new_tokens: 128 } as any)) as { text: string }
		post({ type: 'result', id: msg.id, text: (out.text ?? '').trim(), ms: Math.round(performance.now() - t0) })
	} catch (e) {
		post({ type: 'error', id: msg.id, message: e instanceof Error ? e.message : String(e) })
	}
}
