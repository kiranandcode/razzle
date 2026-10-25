// Public presentation viewer: hosted snapshots (?s=) or self-contained links (?d=).
// Navigation stays in this window, without AI or a connection to the live presenter.
import { Component, useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import { connect, presentAlone, nav, setBlack, useRazzle } from '../model/client'
import { writeLocalDeck } from '../model/localStore'
import { BadLinkError, loadSharedDeck, type SharedDeck } from '../model/share'
import { movePosition } from '../model/slides'
import type { Deck } from '../model/types'
import { RAZZLE_THEME } from '../theme'
import { Audience } from './Audience'
import './present.css'
import './shared.css'
import { readSlides, type SlideInfo } from './slideInfo'

const SHARED_ID = 'shared'
const toggleFullscreen = () => {
	if (document.fullscreenElement) void document.exitFullscreen?.()
	else void document.documentElement.requestFullscreen?.().catch(() => {})
}

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

const linkData = () => location.hash.split('?')[1] ?? ''

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
		const controller = new AbortController()
		setLoaded({ kind: 'loading' })
		Promise.all([loadSharedDeck(data, controller.signal), preloadFonts()]).then(
			([shared]) => alive && setLoaded({ kind: 'ready', deck: { ...shared, id: SHARED_ID } }),
			(e) => alive && setLoaded({ kind: 'error', message: e instanceof BadLinkError ? e.message : 'the link could not be read' })
		)
		return () => {
			alive = false
			controller.abort()
		}
	}, [data])

	useEffect(() => {
		document.title = loaded.kind === 'ready' ? `${loaded.deck.title} · Razzle` : 'Razzle'
	}, [loaded])

	if (loaded.kind === 'loading') return <div className="rz-present"><div className="rz-loading">Opening the talk…</div></div>
	if (loaded.kind === 'error') return <BadLink message={loaded.message} />
	return (
		<Guard key={data} fallback={<BadLink message="the deck in the link could not be shown" />}>
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
			toggleFullscreen()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [])

	const state = useRazzle((s) => s.state)
	const visible = deck.slides.filter((s) => !s.razzle?.hidden)
	const walk = deck.slides.map((s) => ({ hidden: !!s.razzle?.hidden, stepCount: Math.max(1, s.stepCount) }))
	const current = deck.slides[state.slideIndex]
	const position = { slide: state.slideIndex, step: state.step }
	const previous = current && movePosition(walk, position, -1)
	const next = current && movePosition(walk, position, 1)
	return (
		<div className="rz-present rz-shared">
			<Audience deck={deck} version={1} slides={slides} onLoaded={onLoaded} bare />
			<nav className="rz-share-toolbar" aria-label="Presentation controls">
				<span className="rz-share-title" title={deck.title}>{deck.title}</span>
				<button disabled={!previous} onClick={() => nav('prev')} aria-label="Previous build or slide">←</button>
				<span aria-live="polite">{Math.max(1, visible.findIndex((s) => s.id === current?.id) + 1)} / {visible.length}
					{current?.stepCount > 1 && <small> · build {state.step + 1}/{current.stepCount}</small>}
				</span>
				<button disabled={!next} onClick={() => nav('next')} aria-label="Next build or slide">→</button>
				{state.black && <button onClick={() => setBlack(false)}>Show slides</button>}
				<button onClick={toggleFullscreen}>Fullscreen</button>
				<button onClick={() => openInStudio(deck)} title="Keep an editable copy in this browser">Make a copy</button>
			</nav>
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
			<p>Razzle could not read it: {message}. Ask the sender for a new link if this persists.</p>
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
