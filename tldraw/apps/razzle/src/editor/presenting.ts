// Starting a talk from the studio.
import { Editor } from 'tldraw'
import { BASE } from '../model/base'
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

const onThisMachine = ['localhost', '127.0.0.1', '::1'].includes(location.hostname)

/** The presenter app (audience on the projector, speaker view on the laptop). A local server
 *  launches it; from a hosted server the app is opened on this computer by its link,
 *  razzle-presenter://present?server=…&deck=…&slide=… (presenter/, built with presenter/build.sh). */
export async function presentWithApp(editor: Editor, deckId: string, from: 'current' | 'nearest' = 'current') {
	const slide = startIndex(editor, from)
	if (onThisMachine) {
		const r = await present(deckId, slide)
		if (!r.ok) throw new Error(`could not start the presenter (${r.status})`)
		return
	}
	setMode('present', undefined, deckId)
	nav('goto', { slide, step: 0 })
	const q = new URLSearchParams({ server: location.origin + BASE, deck: deckId, slide: String(slide) })
	location.href = `razzle-presenter://present?${q}`
}

/** Present in this browser: audience full screen in this tab, speaker view in a new window.
 *  The public build presents from the deck kept in the browser, so callers flush first. */
export function presentHere(editor: Editor, deckId: string, from: 'current' | 'nearest' = 'current') {
	const slide = startIndex(editor, from)
	setMode('present', undefined, deckId)
	nav('goto', { slide, step: 0 })
	const q = `deck=${encodeURIComponent(deckId)}`
	window.open(`${location.pathname}#/present?view=speaker&${q}`, 'razzle-speaker', 'popup,width=1280,height=800')
	document.documentElement.requestFullscreen?.().catch(() => {})
	location.hash = `#/present?view=audience&${q}`
}
