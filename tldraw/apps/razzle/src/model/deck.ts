// Deck storage on the Razzle server (docs/DESIGN.md, "HTTP").
import type { Deck } from './types'

export interface DeckSummary {
	id: string
	title: string
	updatedAt: number
	slideCount: number
}

/** Thrown for a 409: the server holds a newer version than the one these edits build on. */
export class StaleDeckError extends Error {}

async function json<T>(res: Response): Promise<T> {
	if (res.status === 409) throw new StaleDeckError('deck changed on the server')
	if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
	return res.json() as Promise<T>
}

const deckUrl = (id: string) => `/api/decks/${encodeURIComponent(id)}`

export const listDecks = () => fetch('/api/decks').then((r) => json<DeckSummary[]>(r))
export const loadDeck = (id: string) => fetch(deckUrl(id)).then((r) => json<Deck>(r))
export const saveDeck = (deck: Deck) =>
	fetch(deckUrl(deck.id), {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(deck),
	}).then((r) => json<{ ok: boolean; updatedAt: number }>(r))
export const generateNotes = (id: string) => fetch(`${deckUrl(id)}/notes`, { method: 'POST' }).then((r) => json<Deck>(r))
export const present = (deckId: string, slide?: number) =>
	fetch('/api/present', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ deckId, slide }),
	})
