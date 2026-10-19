// Razzle presentation screens (docs/DESIGN.md, "Screens"):
//   #/present?view=audience&deck=<id>   the slide, full-bleed
//   #/present?view=speaker&deck=<id>    current + next, script, notes, transcript, cues, timer, orb, hidden slides
// Both render only the server's state (slide + build step) and send `nav` for
// human input; they never advance on their own.
import { useCallback, useEffect, useState } from 'react'
import type { Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import { connect, useRazzle } from '../model/client'
import { route } from '../model/route'
import { Audience } from './Audience'
import './present.css'
import { readSlides, type SlideInfo } from './slideInfo'
import { Speaker } from './Speaker'
import { useDeck } from './useDeck'

export interface PresentScreenProps {
	view: 'audience' | 'speaker'
	/** Defaults to the route's `deck`, else the deck the server is presenting. */
	deckId?: string | null
}

export default function PresentScreen({ view, deckId: deckProp }: PresentScreenProps) {
	const serverDeck = useRazzle((s) => s.state.deckId)
	const deckId = deckProp ?? route.deckId ?? serverDeck

	useEffect(() => {
		connect(view, deckId ?? undefined)
	}, [view, deckId])

	const { deck, version, error } = useDeck(deckId)
	const [slides, setSlides] = useState<SlideInfo[]>([])
	const onLoaded = useCallback((editor: Editor) => {
		setSlides(readSlides(editor))
		if (import.meta.env.DEV) (window as any).__razzlePresent = { editor, view }
	}, [view])

	useEffect(() => {
		document.title = deck ? `${deck.title} · ${view}` : 'Razzle'
	}, [deck, view])

	return (
		<div className="rz-present">
			{view === 'speaker' ? (
				<Speaker deck={deck} version={version} slides={slides} onLoaded={onLoaded} />
			) : (
				<Audience deck={deck} version={version} slides={slides} onLoaded={onLoaded} />
			)}
			{!deck && view === 'speaker' && (
				<div className="rz-loading">{error ? `Could not load the deck: ${error}` : deckId ? 'Loading…' : 'No deck.'}</div>
			)}
		</div>
	)
}
