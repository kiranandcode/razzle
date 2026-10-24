// Browser speech recognition for a server in RAZZLE_AUDIO=browser mode (docs/DESIGN.md, "Audio").
// Loaded on demand by ./mic.ts; never part of the public build (vite.config.ts stubs it out).
//
// mic (getUserMedia, echo cancellation + noise suppression) -> AudioWorklet (downmix, 16 kHz)
// -> Segmenter (the server's energy VAD and segment rules) -> Whisper in ./worker.ts:
//   every ~600 ms the open segment       -> {t:'asr', kind:'partial'}
//   a closed segment, once               -> {t:'asr', kind:'pause'} then {kind:'final'} with the same text
// There is one model in the browser (whisper base.en on WebGPU, tiny.en on the CPU; ./worker.ts),
// so the final reuses the pause transcription. The server holds the authoritative state; we send
// only while we hold the mic ({t:'mic', on:true}). Segment ids are ours; the server remaps them.
import { BASE } from '../model/base'
import { getRazzle, on, onOpen, send, sendLive } from '../model/client'
import { getMicView, setMicView } from './mic'
import { rms, SEG_TUNING, Segmenter, type SegEvent } from './segmenter'
import type { AsrOverrides } from './worker'

/** Transcription times (ms) of this page's partials and pauses, for diagnostics (window.__razzleAsr). */
export const stats = { device: null as 'webgpu' | 'wasm' | null, model: '', loadMs: 0, samples: 0, peak: 0, segments: 0, partial: [] as number[], pause: [] as number[] }
;(globalThis as any).__razzleAsr = stats

// localStorage 'razzle-asr' = '{"device":"wasm"}' forces the CPU path (when WebGPU misbehaves);
// see AsrOverrides in ./worker.ts for the other knobs
function overrides(): AsrOverrides {
	try {
		return JSON.parse(localStorage.getItem('razzle-asr') ?? '{}') ?? {}
	} catch {
		return {}
	}
}

const WORKLET = `
class RazzleDownsample extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / 16000; this.pos = 0; this.acc = 0; this.n = 0; this.out = new Float32Array(640); this.len = 0 }
  process(inputs) {
    const chans = inputs[0]
    if (!chans || !chans.length) return true
    const len = chans[0].length, k = chans.length
    for (let i = 0; i < len; i++) {
      let v = 0
      for (let c = 0; c < k; c++) v += chans[c][i]
      this.acc += v / k; this.n++; this.pos += 1
      // box filter over each output sample's input window, then decimate
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio
        this.out[this.len++] = this.acc / this.n
        this.acc = 0; this.n = 0
        if (this.len === this.out.length) { this.port.postMessage(this.out, [this.out.buffer]); this.out = new Float32Array(640); this.len = 0 }
      }
    }
    return true
  }
}
registerProcessor('razzle-downsample', RazzleDownsample)
`

type WorkerOut =
	| { type: 'progress'; loaded: number; total: number }
	| { type: 'ready'; device: 'webgpu' | 'wasm'; model: string; detail: string; ms: number }
	| { type: 'result'; id: number; text: string; ms: number }
	| { type: 'error'; id?: number; message: string }

// ---------------------------------------------------------------- the worker (kept across mic sessions)

let worker: Worker | null = null
let ready: Promise<{ device: 'webgpu' | 'wasm'; model: string }> | null = null
let jobId = 0
const jobs = new Map<number, { resolve: (r: { text: string; ms: number }) => void; reject: (e: Error) => void }>()

function loadModel(): Promise<{ device: 'webgpu' | 'wasm'; model: string }> {
	if (ready) return ready
	ready = new Promise((resolve, reject) => {
		worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'razzle-asr' })
		const fail = (error: Error) => {
			clearTimeout(timer)
			worker?.terminate()
			worker = null
			ready = null
			for (const job of jobs.values()) job.reject(error)
			jobs.clear()
			reject(error)
			if (session) {
				void stop().then(() => setMicView({ status: 'error', message: error.message }))
			}
		}
		const timer = setTimeout(() => fail(new Error('Speech model startup timed out. Click the mic to retry.')), 120000)
		worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
			const m = ev.data
			if (m.type === 'progress') setMicView({ progress: m.total ? m.loaded / m.total : null })
			else if (m.type === 'ready') {
				clearTimeout(timer)
				console.info(`[razzle asr] ${m.model} ${m.detail}, ready in ${m.ms} ms`)
				stats.device = m.device
				stats.model = m.model
				stats.loadMs = m.ms
				resolve(m)
			} else if (m.type === 'result') {
				jobs.get(m.id)?.resolve(m)
				jobs.delete(m.id)
			} else if (m.type === 'error') {
				if (m.id === undefined) {
					fail(new Error(`speech model failed to load: ${m.message}`))
				} else {
					jobs.get(m.id)?.reject(new Error(m.message))
					jobs.delete(m.id)
				}
			}
		}
		worker.onerror = (e) => {
			fail(new Error(`speech worker failed: ${e.message || 'could not start'}`))
		}
		// a path, not a URL: transformers.js only tries a local copy (and reads its size) for paths
		const modelsUrl = `${BASE}/models/`
		worker.postMessage({ type: 'load', modelsUrl, overrides: overrides() })
	})
	return ready
}

export const warmup = () => loadModel()

async function transcribe(pcm: Float32Array): Promise<{ text: string; ms: number }> {
	await loadModel()
	return new Promise((resolve, reject) => {
		if (!worker) return reject(new Error('no speech worker'))
		const id = ++jobId
		jobs.set(id, { resolve, reject })
		const copy = pcm.slice()
		worker.postMessage({ type: 'run', id, pcm: copy }, [copy.buffer])
	})
}

// ---------------------------------------------------------------- one mic session

interface Session {
	stream: MediaStream
	ctx: AudioContext
	node: AudioWorkletNode
	seg: Segmenter
	timer: ReturnType<typeof setInterval>
	unsub: (() => void)[]
	// client segment ids the server has been told about (segment-start sent)
	live: Set<number>
	pending: Promise<void>[]
	partialBusy: boolean
	// we have claimed the mic (and the server has not said otherwise)
	held: boolean
	level: number
	levelAt: number
	modelReady: boolean
	notice: string
}

let session: Session | null = null
let run = 0

function micError(e: unknown): Error {
	const name = (e as any)?.name
	if (name === 'NotAllowedError' || name === 'SecurityError') return new Error('Microphone permission was denied. Allow it in the browser’s site settings and try again.')
	if (name === 'NotFoundError' || name === 'OverconstrainedError') return new Error('No microphone was found.')
	if (name === 'NotReadableError') return new Error('The microphone is in use by another application.')
	return e instanceof Error ? e : new Error(String(e))
}

const accepting = () => getRazzle().state.mode !== 'idle'

export async function start(): Promise<void> {
	if (session) return
	const my = ++run
	if (!navigator.mediaDevices?.getUserMedia) throw new Error('This page cannot use the microphone (it needs https or localhost).')
	if (typeof AudioWorkletNode === 'undefined') throw new Error('This browser has no AudioWorklet.')
	setMicView({ status: 'loading', message: '', progress: null })
	// the model and the permission prompt in parallel
	const model = loadModel()
	void model.catch(() => {})
	let stream: MediaStream
	try {
		stream = await navigator.mediaDevices.getUserMedia({
			audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
		})
	} catch (e) {
		model.catch(() => {}) // still loading; kept for the next try
		throw micError(e)
	}
	if (my !== run) {
		stream.getTracks().forEach((t) => t.stop())
		return // switched off while loading
	}

	const ctx = new AudioContext()
	const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }))
	try {
		await ctx.audioWorklet.addModule(url)
	} catch (e) {
		stream.getTracks().forEach((t) => t.stop())
		void ctx.close()
		throw e
	} finally {
		URL.revokeObjectURL(url)
	}
	if (my !== run) {
		stream.getTracks().forEach((t) => t.stop())
		void ctx.close()
		return
	}
	const src = ctx.createMediaStreamSource(stream)
	const node = new AudioWorkletNode(ctx, 'razzle-downsample', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
	const mute = ctx.createGain()
	mute.gain.value = 0
	src.connect(node).connect(mute).connect(ctx.destination)

	const s: Session = {
		stream, ctx, node, seg: new Segmenter(Date.now()), timer: 0 as any, unsub: [], live: new Set(), pending: [],
		partialBusy: false, held: false, level: 0, levelAt: 0, modelReady: false, notice: '',
	}
	session = s
	node.port.onmessage = (ev: MessageEvent<Float32Array>) => onSamples(s, ev.data)
	s.timer = setInterval(() => tickPartial(s), SEG_TUNING.partialEveryMs)

	let position = JSON.stringify([getRazzle().state.deckId, getRazzle().state.slideIndex, getRazzle().state.step, getRazzle().state.mode])
	s.unsub.push(
		on('state', ({ state }) => {
			const next = JSON.stringify([state.deckId, state.slideIndex, state.step, state.mode])
			if (position !== next) s.seg.flush().forEach((e) => onSegEvent(s, e))
			position = next
		}),
		on('mic', (m) => {
			if (session !== s) return
			if (!m.held && s.held) {
				// another screen took the mic, or the server let go of it
				void stop(m.message ? `Mic released: ${m.message}.` : '')
			}
		}),
		onOpen(() => {
			// reconnected: the server forgot our claim; take it again and re-open the live segment
			if (session !== s) return
			s.live.clear()
			send({ t: 'mic', on: true })
			s.held = true
			const open = s.seg.open
			if (open && accepting()) {
				s.live.add(open.segId)
				sendLive({ t: 'asr', kind: 'segment-start', segId: open.segId, t0: open.t0 })
			}
		})
	)
	const tracks = stream.getAudioTracks()
	tracks.forEach((t) => (t.onended = () => session === s && void stop('The microphone was disconnected.')))

	// claimed from here on; the server answers {t:'mic', held} and tells us if another screen takes it
	send({ t: 'mic', on: true })
	s.held = true
	resumeAudio(s)
	try {
		const { device, model: modelName } = await model
		if (session !== s) return
		s.modelReady = true
		s.notice = device === 'wasm' ? 'Transcribing on the CPU.' : ''
		setMicView({ device, model: modelName.replace(/^.*\//, ''), progress: null })
		updateCaptureStatus(s)
	} catch (e) {
		if (session === s) await stop()
		throw e
	}
}

function updateCaptureStatus(s: Session) {
	if (session !== s) return
	if (s.ctx.state !== 'running') setMicView({ status: 'waiting', message: 'Click the mic or press a key to start listening.' })
	else setMicView({ status: s.modelReady ? 'listening' : 'loading', message: s.modelReady ? s.notice : 'Capturing speech while the model loads…' })
}

// resume() may stay pending until a gesture. Register that gesture before calling it.
function resumeAudio(s: Session) {
	const go = () => {
		if (s.ctx.state === 'running' || session !== s) return
		void s.ctx.resume().then(() => updateCaptureStatus(s)).catch(() => {})
	}
	s.ctx.onstatechange = () => updateCaptureStatus(s)
	window.addEventListener('pointerdown', go, true)
	window.addEventListener('keydown', go, true)
	s.unsub.push(() => {
		window.removeEventListener('pointerdown', go, true)
		window.removeEventListener('keydown', go, true)
		s.ctx.onstatechange = null
	})
	updateCaptureStatus(s)
	go()
}

export function resume() {
	if (session) void session.ctx.resume().then(() => session && updateCaptureStatus(session))
}

export async function stop(message = ''): Promise<void> {
	run++
	const s = session
	if (!s) {
		setMicView({ status: getMicView().status === 'error' ? 'error' : 'off', level: 0, ...(message ? { message } : {}) })
		return
	}
	session = null
	clearInterval(s.timer)
	s.node.port.onmessage = null
	s.unsub.forEach((u) => u())
	s.stream.getTracks().forEach((t) => t.stop())
	void s.ctx.close().catch(() => {})
	// close the open segment so its final reaches the take, then let go
	s.seg.flush().forEach((e) => onSegEvent(s, e))
	await Promise.race([Promise.all(s.pending), new Promise((r) => setTimeout(r, 120000))])
	if (s.held) send({ t: 'mic', on: false })
	if (!session) setMicView({ status: 'off', level: 0, message })
}

function onSamples(s: Session, x: Float32Array) {
	if (session !== s) return
	stats.samples += x.length
	stats.peak = Math.max(stats.peak, rms(x))
	// level meter: fast attack, slow release, published at most every 80 ms
	const r = Math.min(1, rms(x) * 8)
	s.level = r > s.level ? r : s.level * 0.85 + r * 0.15
	const now = performance.now()
	if (now - s.levelAt > 80) {
		s.levelAt = now
		setMicView({ level: s.level })
	}
	for (const e of s.seg.push(x)) onSegEvent(s, e)
}

function onSegEvent(s: Session, e: SegEvent) {
	if (e.type === 'start') {
		stats.segments++
		if (!s.held || !accepting()) return // idle: the server would drop it, so it is not transcribed either
		s.live.add(e.segId)
		sendLive({ t: 'asr', kind: 'segment-start', segId: e.segId, t0: e.t0 })
		return
	}
	if (!s.live.has(e.segId)) return
	if (e.type === 'drop') {
		s.live.delete(e.segId)
		sendLive({ t: 'asr', kind: 'final', segId: e.segId, text: '' })
		return
	}
	// closed: one transcription, sent as the pause (cue matching, the director) and the final
	const job = transcribe(e.pcm).then(
		({ text, ms }) => {
			setMicView({ pauseMs: ms })
			stats.pause.push(ms)
			if (!s.live.has(e.segId)) return
			s.live.delete(e.segId)
			if (!e.flush) sendLive({ t: 'asr', kind: 'pause', segId: e.segId, text })
			sendLive({ t: 'asr', kind: 'final', segId: e.segId, text, t0: e.t0, t1: e.t1 })
		},
		(err) => {
			console.warn('[razzle asr] transcription failed:', err)
			if (s.live.delete(e.segId)) sendLive({ t: 'asr', kind: 'final', segId: e.segId, text: '' })
		}
	)
	s.pending.push(job)
	void job.finally(() => (s.pending = s.pending.filter((p) => p !== job)))
}

async function tickPartial(s: Session) {
	const open = s.seg.open
	// skip while the speaker has gone quiet: nothing new to transcribe, and the segment is about to
	// close, when a partial still running would delay its pause transcription
	if (!s.modelReady || !open || s.partialBusy || !s.live.has(open.segId) || open.ms < 400 || open.silentMs >= 200) return
	s.partialBusy = true
	try {
		const { text, ms } = await transcribe(open.pcm())
		setMicView({ partialMs: ms })
		stats.partial.push(ms)
		// after the segment closed this is stale; the server treats it as a late partial (cues only)
		if (text && s.live.has(open.segId)) sendLive({ t: 'asr', kind: 'partial', segId: open.segId, text })
	} catch (err) {
		console.warn('[razzle asr] partial failed:', err)
	} finally {
		s.partialBusy = false
	}
}
