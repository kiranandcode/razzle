// The browser mic's state for the UI, and the switch that loads the speech engine on demand.
// Private build only, and only used when the server says `mic.source === 'browser'`
// (RAZZLE_AUDIO=browser). Nothing heavy lives here: the engine (capture, segmentation, the
// Whisper worker) is a dynamic import, so it costs nothing until the mic is first switched on.
import { useEffect, useSyncExternalStore } from 'react'
import { PUBLIC } from '../model/base'
import { useRazzle } from '../model/client'

export type MicStatus = 'off' | 'loading' | 'waiting' | 'listening' | 'error'

export interface MicView {
	status: MicStatus
	/** Model download progress 0..1 while loading, when known. */
	progress: number | null
	/** Input level 0..1 (smoothed RMS), for the meter. */
	level: number
	device: 'webgpu' | 'wasm' | null
	/** The Whisper export in use (base.en on WebGPU, tiny.en on the CPU). */
	model: string
	/** Why the mic is off or in error, or a notice while listening (no WebGPU, click to start audio). */
	message: string
	/** Transcription times of the latest partial and pause, ms. */
	partialMs: number | null
	pauseMs: number | null
}

let view: MicView = { status: 'off', progress: null, level: 0, device: null, model: '', message: '', partialMs: null, pauseMs: null }
const listeners = new Set<() => void>()

export function setMicView(patch: Partial<MicView>) {
	view = { ...view, ...patch }
	listeners.forEach((l) => l())
}
export const getMicView = () => view

export function useMic<T>(select: (v: MicView) => T): T {
	return useSyncExternalStore(
		(l) => {
			listeners.add(l)
			return () => listeners.delete(l)
		},
		() => select(view)
	)
}

/** True when this page should offer the browser mic: private build, server in browser mode. */
export function useBrowserMic() {
	const source = useRazzle((s) => s.state.mic?.source)
	const connected = useRazzle((s) => s.connected)
	return !PUBLIC && connected && source === 'browser'
}

let engine: Promise<typeof import('./engine')> | null = null
const loadEngine = () => (engine ??= import('./engine'))

// Started by a mode change (Record, Present) rather than the toggle: stopped again when the mode ends.
let auto = false
// The speaker switched the mic off by hand during this session: do not take it back automatically.
let userOff = false

export async function micStart(how: 'user' | 'auto' = 'user') {
	if (PUBLIC) return
	if (how === 'user') userOff = false
	if (view.status === 'listening' || view.status === 'loading' || view.status === 'waiting') return
	auto = how === 'auto'
	setMicView({ status: 'loading', message: '', progress: null })
	try {
		await (await loadEngine()).start()
	} catch (e) {
		setMicView({ status: 'error', message: e instanceof Error ? e.message : String(e) })
	}
}

export async function micStop(how: 'user' | 'auto' = 'user') {
	if (how === 'user') userOff = true
	if (how === 'auto' && !auto) return
	auto = false
	if (!engine) return
	await (await engine).stop()
}

export function micToggle() {
	if (view.status === 'waiting') return loadEngine().then((e) => e.resume())
	return view.status === 'listening' || view.status === 'loading' ? micStop('user') : micStart('user')
}

/** While `active` (a recording or a talk is running) and the server takes speech from the
 *  browser: with `claim`, take the mic (unless switched off by hand this session). When `active`
 *  ends, release a mic that was taken automatically. */
export function useAutoMic(active: boolean, { claim }: { claim: boolean }) {
	const browser = useBrowserMic()
	useEffect(() => {
		if (browser) void loadEngine().then((e) => e.warmup()).catch(() => {})
	}, [browser])
	useEffect(() => {
		if (!browser) return
		if (active) {
			if (claim && !userOff && view.status === 'off') void micStart('auto')
		} else {
			userOff = false
			void micStop('auto')
		}
	}, [browser, active, claim])
}
