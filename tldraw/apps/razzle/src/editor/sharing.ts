// Share a deck as a link that carries the deck itself (src/model/share.ts).
import { Editor } from 'tldraw'
import { LINK_MAX_BYTES, LINK_WARN_BYTES, encodeDeck, shareUrl, sharedDeckOf } from '../model/share'
import { buildSlideIndex } from '../model/slides'
import { DECK_FORMAT, Deck } from '../model/types'

type Toast = (t: { title: string; description?: string; severity?: 'success' | 'info' | 'warning' | 'error' }) => void

const size = (n: number) => (n < 1000 ? `${n} bytes` : n < 1_000_000 ? `${Math.round(n / 100) / 10} KB` : `${Math.round(n / 100_000) / 10} MB`)

export async function copyShareLink(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text)
		return true
	} catch {
		// no clipboard permission (or an insecure page): the old way
		const ta = document.createElement('textarea')
		ta.value = text
		ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
		document.body.appendChild(ta)
		ta.select()
		const ok = document.execCommand('copy')
		ta.remove()
		return ok
	}
}

/** The deck as the editor holds it now. */
export function deckFromEditor(editor: Editor, deck: Deck, title: string): Deck {
	return {
		...deck,
		title,
		format: DECK_FORMAT,
		document: editor.store.getStoreSnapshot('document'),
		slides: buildSlideIndex(editor),
	}
}

/** Saves, builds the link, copies it and says how long it is. Returns the link (or null). */
export async function shareDeck(editor: Editor, deck: Deck, title: string, flush: (() => Promise<void>) | undefined, toast: Toast) {
	try {
		await flush?.()
		const url = shareUrl(await encodeDeck(sharedDeckOf(deckFromEditor(editor, deck, title))))
		if (url.length > LINK_MAX_BYTES) {
			toast({
				title: 'This deck is too large to share as a link',
				description: `The link would be ${size(url.length)}. Export it as PowerPoint or reveal.js from the main menu instead.`,
				severity: 'error',
			})
			return null
		}
		const copied = await copyShareLink(url)
		const big = url.length > LINK_WARN_BYTES
		toast({
			title: copied ? `Link copied (${size(url.length)})` : `Could not copy the link (${size(url.length)})`,
			description: big
				? 'Some chat apps cut links this long; images make a deck large. A PowerPoint or reveal.js export (main menu) travels better.'
				: 'Anyone with the link can view these slides. Speaker notes and hidden slides are excluded.',
			severity: copied ? (big ? 'warning' : 'success') : 'error',
		})
		return url
	} catch (e) {
		toast({ title: 'Could not make a link', description: e instanceof Error ? e.message : String(e), severity: 'error' })
		return null
	}
}
