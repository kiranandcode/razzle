// A shared talk (#/view?d=<data>, src/model/share.ts): the deck comes out of the link and is
// presented here, in this one window, by the in-browser presenter (presentAlone): the audience
// view full-bleed, the usual keys and clicks, `f` for full screen. Hidden slides are skipped and
// cannot be reached. "Open in Razzle" keeps a copy in this browser and opens it in the studio.
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import { connect, presentAlone } from '../model/client'
import { writeLocalDeck } from '../model/localStore'
import { BadLinkError, decodeDeck, type SharedDeck } from '../model/share'
import type { Deck } from '../model/types'
import { RAZZLE_THEME } from '../theme'
import { Audience } from './Audience'
import './present.css'
import './shared.css'
import { readSlides, type SlideInfo } from './slideInfo'

const SHARED_ID = 'shared'

/** The Razzle fonts, loaded before the slide is first laid out: a link usually opens in a browser
 *  that has never fetched them, and text measured in a fallback font wraps wrongly. */
function preloadFonts(): Promise<unknown> {
	const { serif, sans, mono } = RAZZLE_THEME.fonts
	const faces = [serif, sans, mono].flatMap((f) => f?.faces ?? [])
	const loads = faces.map((f) =>
		new FontFace(f.family, `url(${f.src.url})`, { weight: f.weight, style: f.style }).load().then((ff) => void document.fonts.add(ff))
	)
	return Promise.race([Promise.allSettled(loads), new Promise((r) => setTimeout(r, 4000))])
}

const linkData = () => new URLSearchParams(location.hash.replace(/^#/, '').split('?')[1] ?? '').get('d') ?? ''

type Loaded = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; deck: Deck }

export default function SharedView() {
	const [data, setData] = useState(linkData)
	useEffect(() => {
		const onHash = () => setData(linkData())
		window.addEventListener('hashchange', onHash)
		return () => window.removeEventListener('hashchange', onHash)
	}, [])

	const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' })
	useEffect(() => {
		let alive = true
		setLoaded({ kind: 'loading' })
		Promise.all([decodeDeck(data), preloadFonts()]).then(
			([shared]) => alive && setLoaded({ kind: 'ready', deck: { ...shared, id: SHARED_ID } }),
			(e) => alive && setLoaded({ kind: 'error', message: e instanceof BadLinkError ? e.message : 'the link could not be read' })
		)
		return () => {
			alive = false
		}
	}, [data])

	useEffect(() => {
		document.title = loaded.kind === 'ready' ? `${loaded.deck.title} · Razzle` : 'Razzle'
	}, [loaded])

	if (loaded.kind === 'loading') return <div className="rz-present"><div className="rz-loading">Opening the talk…</div></div>
	if (loaded.kind === 'error') return <BadLink message={loaded.message} />
	return (
		<Guard fallback={<BadLink message="the deck in the link could not be shown" />}>
			<SharedTalk key={data} deck={loaded.deck} />
		</Guard>
	)
}

function SharedTalk({ deck }: { deck: Deck }) {
	// This window presents the deck on its own (no server, no other windows).
	useEffect(() => {
		const stop = presentAlone({ deckId: deck.id, slides: deck.slides })
		connect('audience', deck.id)
		return stop
	}, [deck])

	const [slides, setSlides] = useState<SlideInfo[]>([])
	const onLoaded = useCallback((editor: Editor) => setSlides(readSlides(editor)), [])

	// `f`: full screen (the other keys are the audience view's own).
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || (e.key !== 'f' && e.key !== 'F')) return
			e.preventDefault()
			if (document.fullscreenElement) void document.exitFullscreen?.()
			else void document.documentElement.requestFullscreen?.().catch(() => {})
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [])

	// "Open in Razzle" shows while the mouse moves and hides with the cursor (2 s).
	const [awake, setAwake] = useState(false)
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const wake = () => {
		setAwake(true)
		if (timer.current) clearTimeout(timer.current)
		timer.current = setTimeout(() => setAwake(false), 2000)
	}
	useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

	return (
		<div className="rz-present" onMouseMove={wake}>
			<Audience deck={deck} version={1} slides={slides} onLoaded={onLoaded} bare />
			<button className="rz-open-in" data-awake={awake} onClick={() => openInStudio(deck)} title="Keep a copy in this browser and edit it">
				Open in Razzle
			</button>
		</div>
	)
}

/** A copy in this browser's decks (a new id), opened in the studio. */
function openInStudio(deck: SharedDeck) {
	const slug = deck.title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 32)
	const id = `${slug || 'deck'}-${Math.random().toString(36).slice(2, 6)}`
	const ok = writeLocalDeck({ deck: { ...deck, id, updatedAt: undefined }, unsynced: true, savedAt: Date.now() })
	if (!ok) {
		alert('This browser has no room to keep the deck. Free some space (or delete old decks) and try again.')
		return
	}
	location.hash = `#/?deck=${encodeURIComponent(id)}`
}

function BadLink({ message }: { message: string }) {
	return (
		<div className="rz-message">
			<h1>This link does not open a talk</h1>
			<p>Razzle could not read it: {message}. A link copied only in part is the usual cause; ask for it again.</p>
			<button className="rz-btn" onClick={() => (location.hash = '#/')}>
				Open Razzle
			</button>
		</div>
	)
}

/** Shows `fallback` if rendering the deck throws (a document that does not load). */
class Guard extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
	state = { failed: false }
	static getDerivedStateFromError() {
		return { failed: true }
	}
	render() {
		return this.state.failed ? this.props.fallback : this.props.children
	}
}
