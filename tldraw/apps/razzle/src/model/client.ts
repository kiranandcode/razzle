// Razzle server connection (protocol: docs/DESIGN.md, "WebSocket /ws").
// One shared socket per page that reconnects forever. `useRazzle(select)` reads
// the live snapshot in React; events go through `on(type, fn)`.
// The public build has no server: the same API runs on the in-browser presenter
// (localEngine.ts), shared by this browser's windows.
import { useSyncExternalStore } from 'react'
import { BASE, PUBLIC } from './base'
import { startLocalEngine, type LocalEngine, type SoloDeck } from './localEngine'

export type Role = 'editor' | 'audience' | 'speaker' | 'director' | 'cli'
export type AgentStatus = 'offline' | 'listening' | 'thinking' | 'acting' | 'ready'
export type NavSource = 'human' | 'agent' | 'cue'
export type Mode = 'idle' | 'record' | 'present'

export interface PresState {
	deckId: string | null
	slideIndex: number
	step: number
	stepCount: number
	mode: Mode
	auto: boolean
	agent: AgentStatus
	takeId: string | null
	lastNav: { at: number; source: NavSource; action: string } | null
	agentMessage: string
	screens: { audience: number; speaker: number }
	black: boolean
	/** Where speech comes from: the server's own mic (local) or a page holding the mic (browser, src/asr). */
	mic: { source: 'local' | 'browser'; active: boolean }
}

export interface Utterance {
	text: string
	t0: number
	t1: number
	slideId: string
	slideIndex: number
	step: number
}

export interface Highlight {
	slideIndex: number
	elId?: string
	rect?: [number, number, number, number]
	ms?: number
}

export type ServerMessage =
	| { t: 'state'; state: PresState }
	| { t: 'transcript'; partial?: string; final?: Utterance; pause?: { text: string; slideIndex: number; step: number } }
	| { t: 'agent'; status: AgentStatus; message?: string }
	| ({ t: 'highlight' } & Highlight)
	| { t: 'deck-updated'; deckId: string; updatedAt: number }
	| { t: 'hidden-ready'; slideIndex: number; prompt: string }
	| { t: 'cue-fired'; id: string; phrase: string }
	| { t: 'mic'; held: boolean; message?: string }
	| { t: 'error'; message: string }

export interface RazzleSnapshot {
	connected: boolean
	state: PresState
	partial: string
	finals: Utterance[]
}

let snap: RazzleSnapshot = {
	connected: false,
	state: {
		deckId: null,
		slideIndex: 0,
		step: 0,
		stepCount: 1,
		mode: 'idle',
		auto: false,
		agent: 'offline',
		takeId: null,
		lastNav: null,
		agentMessage: '',
		screens: { audience: 0, speaker: 0 },
		black: false,
		mic: { source: 'local', active: false },
	},
	partial: '',
	finals: [],
}
const listeners = new Set<() => void>()
const update = (patch: Partial<RazzleSnapshot>) => {
	snap = { ...snap, ...patch }
	listeners.forEach((l) => l())
}

export const getRazzle = () => snap
export const subscribeRazzle = (l: () => void) => {
	listeners.add(l)
	return () => listeners.delete(l)
}
export function useRazzle<T>(select: (s: RazzleSnapshot) => T): T {
	return useSyncExternalStore(subscribeRazzle, () => select(snap))
}

let ws: WebSocket | null = null
let hello: { role: Role; deckId?: string } | null = null
const handlers = new Map<string, Set<(msg: any) => void>>()
const openHooks = new Set<() => void>()
const queue: string[] = []

const wsUrl = () => `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${BASE}/ws`

const dispatch = (msg: ServerMessage) => {
	switch (msg.t) {
		case 'state':
			update({ state: msg.state })
			break
		case 'agent':
			update({ state: { ...snap.state, agent: msg.status, agentMessage: msg.message ?? '' } })
			break
		case 'transcript':
			if (msg.final) update({ finals: [...snap.finals, msg.final].slice(-200), partial: '' })
			else if (msg.partial !== undefined) update({ partial: msg.partial })
			break
	}
	handlers.get(msg.t)?.forEach((fn) => fn(msg))
}

const open = () => {
	ws = new WebSocket(wsUrl())
	ws.onopen = () => {
		update({ connected: true })
		if (hello) ws!.send(JSON.stringify({ t: 'hello', ...hello }))
		while (queue.length) ws!.send(queue.shift()!)
		openHooks.forEach((fn) => fn())
	}
	ws.onmessage = (ev) => {
		try {
			dispatch(JSON.parse(ev.data))
		} catch {
			/* ignore malformed */
		}
	}
	ws.onclose = () => {
		ws = null
		update({ connected: false, state: { ...snap.state, agent: 'offline' } })
		setTimeout(open, 1000)
	}
}

// The in-browser presenter: the public build's, started on first use, or a share link's
// (presentAlone). Only the engine in use reaches the snapshot.
let engine: LocalEngine | null = null
let shared: LocalEngine | null = null // this browser's shared presentation (public build)
let live: object | null = null
const start = (opts?: { solo: SoloDeck }) => {
	const token = {}
	live = token
	return startLocalEngine(snap.state, (msg) => live === token && dispatch(msg), opts)
}
const local = () => {
	if (!engine) {
		engine = shared ??= start()
		update({ connected: true })
	}
	return engine
}

/** Present a deck this window was handed (a share link) here alone, in any build: until the
 *  returned function runs, `connect`/`send` go to an in-window presenter, not the server. */
export function presentAlone(deck: SoloDeck): () => void {
	const before = snap.state
	const prevLive = live
	const mine = start({ solo: deck })
	engine = mine
	update({ connected: true })
	return () => {
		if (engine !== mine) return
		engine = null
		live = prevLive
		update({ connected: PUBLIC || ws?.readyState === WebSocket.OPEN, state: before })
	}
}

/** Connect (idempotent) and announce our role. */
export function connect(role: Role, deckId?: string) {
	hello = { role, deckId }
	if (PUBLIC || engine) return local().hello(role, deckId)
	if (!ws) open()
	else if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'hello', ...hello }))
}

export function send(msg: Record<string, unknown> & { t: string }) {
	if (PUBLIC || engine) return local().send(msg)
	const s = JSON.stringify(msg)
	if (ws && ws.readyState === WebSocket.OPEN) ws.send(s)
	else queue.push(s)
}

export function on<T extends ServerMessage['t']>(t: T, fn: (msg: Extract<ServerMessage, { t: T }>) => void) {
	if (!handlers.has(t)) handlers.set(t, new Set())
	handlers.get(t)!.add(fn)
	return () => {
		handlers.get(t)!.delete(fn)
	}
}

/** Runs after every (re)connect, once `hello` and the queue have been sent. */
export function onOpen(fn: () => void) {
	openHooks.add(fn)
	return () => {
		openHooks.delete(fn)
	}
}

/** Send now if connected; otherwise drop (live data such as speech is useless later). */
export function sendLive(msg: Record<string, unknown> & { t: string }) {
	if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

export const nav = (action: 'next' | 'prev' | 'goto', opts: { slide?: number; step?: number; source?: NavSource } = {}) =>
	send({ t: 'nav', action, slide: opts.slide, step: opts.step, source: opts.source ?? 'human' })
export const setMode = (mode: Mode, auto?: boolean, deckId?: string) => send({ t: 'mode', mode, auto, deckId })
export const setBlack = (on: boolean) => send({ t: 'black', on })
export const requestHidden = (prompt?: string) => send({ t: 'request', kind: 'hidden-slide', prompt })
