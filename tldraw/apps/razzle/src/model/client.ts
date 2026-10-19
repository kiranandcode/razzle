// Razzle server connection (protocol: docs/DESIGN.md, "WebSocket /ws").
// One shared socket per page that reconnects forever. `useRazzle(select)` reads
// the live snapshot in React; events go through `on(type, fn)`.
import { useSyncExternalStore } from 'react'

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
const queue: string[] = []

const wsUrl = () => `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`

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

/** Connect (idempotent) and announce our role. */
export function connect(role: Role, deckId?: string) {
	hello = { role, deckId }
	if (!ws) open()
	else if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'hello', ...hello }))
}

export function send(msg: Record<string, unknown> & { t: string }) {
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

export const nav = (action: 'next' | 'prev' | 'goto', opts: { slide?: number; step?: number; source?: NavSource } = {}) =>
	send({ t: 'nav', action, slide: opts.slide, step: opts.step, source: opts.source ?? 'human' })
export const setMode = (mode: Mode, auto?: boolean, deckId?: string) => send({ t: 'mode', mode, auto, deckId })
export const setBlack = (on: boolean) => send({ t: 'black', on })
export const requestHidden = (prompt?: string) => send({ t: 'request', kind: 'hidden-slide', prompt })
