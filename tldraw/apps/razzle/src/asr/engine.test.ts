import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	view: { status: 'off' } as Record<string, unknown>,
	send: vi.fn(),
	state: { mode: 'present', deckId: 'demo', slideIndex: 0, step: 0 },
}))
vi.mock('../model/base', () => ({ BASE: '' }))
vi.mock('../model/client', () => ({
	getRazzle: () => ({ state: mocks.state }), send: mocks.send, sendLive: mocks.send,
	on: () => () => {}, onOpen: () => () => {},
}))
vi.mock('./mic', () => ({ getMicView: () => mocks.view, setMicView: (patch: object) => Object.assign(mocks.view, patch) }))

let worker: FakeWorker
let ctx: FakeContext
let node: FakeNode
let addModule: () => Promise<void>
const stopTrack = vi.fn()

class FakeWorker {
	onmessage?: (e: { data: any }) => void
	onerror?: (e: any) => void
	requests: any[] = []
	constructor() { worker = this }
	postMessage(m: any) { this.requests.push(m) }
	terminate() {}
	ready() { this.onmessage?.({ data: { type: 'ready', device: 'wasm', model: 'test', detail: '', ms: 1 } }) }
	finish() {
		for (const r of this.requests.filter((r) => r.type === 'run')) this.onmessage?.({ data: { type: 'result', id: r.id, text: 'A sentence', ms: 1 } })
	}
}
class FakeNode {
	port = { onmessage: null as ((e: { data: Float32Array }) => void) | null }
	constructor() { node = this }
	connect(target: any) { return target }
}
class FakeContext {
	state = 'suspended'
	onstatechange?: () => void
	destination = {}
	audioWorklet = { addModule: () => addModule() }
	resume = vi.fn(() => this.state === 'running' ? Promise.resolve() : new Promise<void>(() => {}))
	close = vi.fn(async () => { this.state = 'closed' })
	constructor() { ctx = this }
	createMediaStreamSource() { return { connect: (target: any) => target } }
	createGain() { return { gain: { value: 0 }, connect: (target: any) => target } }
}

beforeEach(() => {
	vi.resetModules()
	vi.clearAllMocks()
	mocks.view = { status: 'off' }
	addModule = async () => {}
	vi.stubGlobal('Worker', FakeWorker)
	vi.stubGlobal('AudioContext', FakeContext)
	vi.stubGlobal('AudioWorkletNode', FakeNode)
	Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
		getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }], getAudioTracks: () => [] })),
	} })
	URL.createObjectURL = vi.fn(() => 'blob:test')
	URL.revokeObjectURL = vi.fn()
})
afterEach(() => vi.unstubAllGlobals())

test('capture starts before model readiness; suspended audio does not block startup', async () => {
	const engine = await import('./engine')
	const starting = engine.start()
	await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledWith({ t: 'mic', on: true }))
	expect(mocks.view.status).toBe('waiting')
	expect(ctx.resume).toHaveBeenCalled()
	worker.ready()
	await starting
	expect(mocks.view.status).toBe('waiting')
	ctx.state = 'running'
	ctx.onstatechange?.()
	expect(mocks.view.status).toBe('listening')
	const count = ctx.resume.mock.calls.length
	window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
	expect(ctx.resume).toHaveBeenCalledTimes(count)
	await engine.stop()
	expect(stopTrack).toHaveBeenCalledOnce()
})

test('stop releases capture before pending transcription finishes', async () => {
	const engine = await import('./engine')
	const starting = engine.start()
	await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledWith({ t: 'mic', on: true }))
	worker.ready()
	await starting
	ctx.state = 'running'
	const speech = Float32Array.from({ length: 16000 }, (_, i) => 0.2 * Math.sin(i / 5))
	node.port.onmessage?.({ data: speech })
	const stopping = engine.stop()
	expect(stopTrack).toHaveBeenCalledOnce()
	expect(ctx.close).toHaveBeenCalledOnce()
	await vi.waitFor(() => expect(worker.requests.some((r) => r.type === 'run')).toBe(true))
	worker.finish()
	await stopping
	expect(mocks.send.mock.calls.some(([m]) => m.kind === 'final' && m.text === 'A sentence')).toBe(true)
})

test('stop during worklet setup cannot reclaim the microphone', async () => {
	let loaded!: () => void
	addModule = () => new Promise<void>((resolve) => { loaded = resolve })
	const engine = await import('./engine')
	const starting = engine.start()
	await vi.waitFor(() => expect(loaded).toBeTypeOf('function'))
	await engine.stop()
	loaded()
	worker.ready()
	await starting
	expect(stopTrack).toHaveBeenCalledOnce()
	expect(ctx.close).toHaveBeenCalledOnce()
	expect(mocks.send).not.toHaveBeenCalledWith({ t: 'mic', on: true })
})
