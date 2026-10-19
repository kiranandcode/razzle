// Starting a talk from the studio.
import { Editor } from 'tldraw'
import { nav, setMode } from '../model/client'
import { present } from '../model/deck'
import { getSlides } from '../model/slides'
import { currentSlide, nearestSlide } from './slideOps'

/** Reading-order index of the slide to start from. */
export function startIndex(editor: Editor, from: 'current' | 'nearest' = 'current') {
	const slides = getSlides(editor)
	const s = from === 'current' ? currentSlide(editor) : nearestSlide(editor, slides)
	return Math.max(0, slides.findIndex((x) => x.id === s?.id))
}

/** The presenter app (audience on the projector, speaker view on the laptop). */
export async function presentWithApp(editor: Editor, deckId: string, from: 'current' | 'nearest' = 'current') {
	const slide = startIndex(editor, from)
	const r = await present(deckId, slide)
	if (!r.ok) throw new Error(`could not start the presenter (${r.status})`)
}

/** Present in this browser: audience full screen in this tab, speaker view in a new window. */
export function presentHere(editor: Editor, deckId: string) {
	const slide = startIndex(editor)
	setMode('present', undefined, deckId)
	nav('goto', { slide, step: 0 })
	const q = `deck=${encodeURIComponent(deckId)}`
	window.open(`${location.pathname}#/present?view=speaker&${q}`, 'razzle-speaker', 'popup,width=1280,height=800')
	document.documentElement.requestFullscreen?.().catch(() => {})
	location.hash = `#/present?view=audience&${q}`
}
