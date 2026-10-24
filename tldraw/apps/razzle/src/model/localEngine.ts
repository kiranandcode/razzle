// The public studio's presenter: the part of the Razzle server the screens need, run in the
// browser (docs/DESIGN.md, "Presenting model" and "WebSocket /ws"). The public build has no
// server, so `client.ts` routes `hello`, `nav`, `mode`, `black` and `steps` here instead.
//
// One presentation state per browser, shared by its windows (the audience tab, the speaker
// popup, any studio tab) over a BroadcastChannel. One window is authoritative: whichever holds
// the Web Lock `razzle-local-presenter`, i.e. the first window to start; the others mirror its
// state and forward their requests to it. When it closes, the lock passes to a waiting window,
// which carries on from the last state it mirrored and asks every window to say hello again.
//
// Navigation follows server/state.ts (`move`): next/prev walk build steps and skip hidden
// slides, goto reaches any slide. Only human navigation exists here, so the debounce rules
// (which only drop agent and cue moves, or a human next right after one) never apply.
// No mic, transcript, agent or cues: `agent` stays 'offline' and `auto` stays false.
//
// `solo`: one window presenting a deck it was handed (a share link, src/present/SharedView.tsx),
// on its own: no channel, no lock, no browser-kept decks, and hidden slides are not reachable.
import type { PresState, Role, ServerMessage } from './client'
import { onLocalDeckWritten, readLocalDeck } from './localStore'
import { movePosition } from './slides'
import type { SlideIndex } from './types'

const LOCK = 'razzle-local-presenter'
const CHANNEL = 'razzle-local-present'

/** A client message (the WebSocket protocol's client → server half). */
type ClientMsg = Record<string, unknown> & { t: string }

type Wire =
	| { k: 'req'; from: string; msg: ClientMsg }
	| { k: 'state'; state: PresState }
	| { k: 'roll' } // a new authoritative window: every window says hello again
	| { k: 'bye'; from: string }

export interface LocalEngine {
	/** Announce this window's role (as the server's `hello`). */
	hello(role: Role, deckId?: string): void
	send(msg: ClientMsg): void
}

export interface SoloDeck {
	deckId: string
	slides: SlideIndex[]
}

export function startLocalEngine(initial: PresState, deliver: (msg: ServerMessage) => void, opts: { solo?: SoloDeck } = {}): LocalEngine {
	const { solo } = opts
	const me = Math.random().toString(36).slice(2, 10)
	const channel = solo || typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL)
	let state: PresState = { ...initial, mode: 'idle', auto: false, agent: 'offline', agentMessage: '', takeId: null, mic: { ...initial.mic, active: false } }
	let leader = false
	let elected = false // leader or follower known; until then requests wait in `pending`
	const pending: ClientMsg[] = []
	let myHello: { role: Role; deckId?: string } | null = null

	// Authoritative window only.
	const roles = new Map<string, Role>()
	let slides: SlideIndex[] = []
	const stepOverrides = new Map<string, number>() // `steps` reports, by slide id

	const post = (w: Wire) => channel?.postMessage(w)

	const publish = () => {
		post({ k: 'state', state })
		deliver({ t: 'state', state })
	}

	const stepsAt = (i: number) => {
		const s = slides[i]
		if (!s) return 1
		const n = stepOverrides.get(s.id) ?? s.stepCount
		return typeof n === 'number' && Number.isFinite(n) ? Math.max(1, Math.trunc(n)) : 1
	}

	const readSlides = (id: string) => (solo ? (id === solo.deckId ? solo.slides : null) : (readLocalDeck(id)?.deck.slides ?? null))

	function setDeck(id: string) {
		const found = readSlides(id)
		slides = found ?? []
		stepOverrides.clear()
		state = { ...state, deckId: found ? id : null, slideIndex: 0, step: 0, stepCount: stepsAt(0) }
	}

	/** The deck changed under a running presentation: keep the position where it still exists. */
	function refreshFromDeck() {
		const n = slides.length
		const slideIndex = n ? Math.min(state.slideIndex, n - 1) : 0
		const stepCount = stepsAt(slideIndex)
		state = { ...state, slideIndex, stepCount, step: Math.min(state.step, stepCount - 1) }
	}

	function countScreens() {
		const n = (role: Role) => [...roles.values()].filter((r) => r === role).length
		state = { ...state, screens: { audience: n('audience'), speaker: n('speaker') } }
	}

	function navigate(msg: ClientMsg): boolean {
		const n = slides.length
		if (!n || (msg.source ?? 'human') !== 'human') return false
		const cur = Math.min(Math.max(state.slideIndex, 0), n - 1)
		let to: { slide: number; step: number } | null
		if (msg.action === 'next' || msg.action === 'prev') {
			const walk = slides.map((s, i) => ({ hidden: !!s.razzle?.hidden, stepCount: stepsAt(i) }))
			to = movePosition(walk, { slide: cur, step: state.step }, msg.action === 'next' ? 1 : -1)
		} else if (msg.action === 'goto' && typeof msg.slide === 'number' && Number.isFinite(msg.slide)) {
			const slide = Math.min(Math.max(Math.trunc(msg.slide), 0), n - 1)
			const want = typeof msg.step === 'number' && Number.isFinite(msg.step) ? Math.trunc(msg.step) : 0
			if (solo && slides[slide].razzle?.hidden) return false // a shared talk shows only its main flow
			to = { slide, step: Math.min(Math.max(want, 0), stepsAt(slide) - 1) }
		} else to = null
		if (!to) return false
		state = {
			...state,
			slideIndex: to.slide,
			step: to.step,
			stepCount: stepsAt(to.slide),
			lastNav: { at: Date.now(), source: 'human', action: String(msg.action) },
		}
		return true
	}

	/** Authoritative window: apply one client message, as server/server.ts does. */
	function handle(from: string, msg: ClientMsg) {
		switch (msg.t) {
			case 'hello': {
				const role = String(msg.role ?? 'editor') as Role
				roles.set(from, role)
				const deckId = typeof msg.deckId === 'string' ? msg.deckId : undefined
				if (deckId && state.mode === 'idle' && (role === 'audience' || role === 'speaker') && deckId !== state.deckId) setDeck(deckId)
				countScreens()
				break
			}
			case 'bye':
				roles.delete(from)
				countScreens()
				break
			case 'black':
				state = { ...state, black: !!msg.on }
				break
			case 'nav':
				navigate(msg) // a refused move republishes the unchanged state, as the server answers its sender
				break
			case 'mode': {
				const deckId = typeof msg.deckId === 'string' ? msg.deckId : undefined
				if (deckId && deckId !== state.deckId) setDeck(deckId)
				const mode = msg.mode === 'present' || msg.mode === 'record' ? msg.mode : 'idle'
				// no recording without a server; presenting needs a deck
				if (mode === 'record' || (mode === 'present' && !state.deckId)) break
				state = { ...state, mode, black: false }
				break
			}
			case 'steps': {
				const i = msg.slideIndex as number
				const n = msg.stepCount as number
				const s = slides[i]
				if (!s || !Number.isInteger(n) || n < 1 || n > 200) return
				stepOverrides.set(s.id, n)
				if (i !== state.slideIndex || n === state.stepCount) return
				state = { ...state, stepCount: n, step: Math.min(state.step, n - 1) }
				break
			}
			default:
				return // mic, asr, request, highlight, agent: nothing serves them in the public build
		}
		publish()
	}

	function dispatchLocal(msg: ClientMsg) {
		if (leader) handle(me, msg)
		else post({ k: 'req', from: me, msg })
	}

	function becomeLeader() {
		leader = true
		roles.clear()
		if (myHello) roles.set(me, myHello.role)
		// carry on from the mirrored state, against the deck as this browser now holds it
		if (state.deckId) {
			const found = readSlides(state.deckId)
			if (found) {
				slides = found
				refreshFromDeck()
			} else state = { ...state, deckId: null, mode: 'idle' }
		}
		countScreens()
		post({ k: 'roll' })
		publish()
	}

	function elect() {
		elected = true
		while (pending.length) dispatchLocal(pending.shift()!)
	}

	if (channel) {
		channel.onmessage = (ev: MessageEvent<Wire>) => {
			const w = ev.data
			if (!w || typeof w !== 'object') return
			if (w.k === 'state') {
				if (leader) return
				state = w.state
				deliver({ t: 'state', state })
			} else if (w.k === 'req') {
				if (leader) handle(w.from, w.msg)
			} else if (w.k === 'bye') {
				if (leader) handle(w.from, { t: 'bye' })
			} else if (w.k === 'roll') {
				if (!leader && myHello) post({ k: 'req', from: me, msg: { t: 'hello', ...myHello } })
			}
		}
	}

	// Leader election by Web Lock: held for the life of the window, released when it closes.
	const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
	const hold = () => new Promise<void>(() => {})
	if (solo) {
		becomeLeader()
		setDeck(solo.deckId)
		const first = Math.max(0, slides.findIndex((s) => !s.razzle?.hidden))
		state = { ...state, mode: 'present', slideIndex: first, step: 0, stepCount: stepsAt(first) }
		elect()
		publish()
	} else if (locks && channel) {
		locks
			.request(LOCK, { ifAvailable: true }, (lock) => {
				if (lock) {
					becomeLeader()
					elect()
					return hold()
				}
				elect()
				// wait to take over when the authoritative window goes away
				void locks.request(LOCK, () => {
					becomeLeader()
					return hold()
				})
				return undefined
			})
			.catch(() => {
				becomeLeader()
				elect()
			})
	} else {
		// no Web Locks or BroadcastChannel: this window presents on its own
		becomeLeader()
		elect()
	}

	if (!solo) {
		window.addEventListener('pagehide', () => {
			if (!leader) post({ k: 'bye', from: me })
		})
	}

	// Edits saved in this browser (the studio tab): screens reload the deck on `deck-updated`,
	// and the authoritative window re-reads slides and step counts.
	if (!solo) onLocalDeckWritten(({ deckId, savedAt }) => {
		if (leader && deckId === state.deckId) {
			const found = readSlides(deckId)
			if (found) {
				slides = found
				stepOverrides.clear()
				refreshFromDeck()
				publish()
			}
		}
		deliver({ t: 'deck-updated', deckId, updatedAt: savedAt })
	})

	return {
		hello(role, deckId) {
			myHello = { role, deckId }
			this.send({ t: 'hello', role, deckId })
		},
		send(msg) {
			if (elected) dispatchLocal(msg)
			else pending.push(msg)
		},
	}
}
