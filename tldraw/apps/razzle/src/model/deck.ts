// Deck storage on the Razzle server (docs/DESIGN.md, "HTTP").
import { BASE, PUBLIC } from './base'
import type { PresentationOptions } from './client'
import type { Deck } from './types'

export interface DeckSummary {
	id: string
	title: string
	updatedAt: number
	slideCount: number
}

export interface PublishedShare {
	id: string
	deckId: string
	title: string
	createdAt: number
}

export const listShares = (deckId: string) =>
	api(`/shares?deck=${encodeURIComponent(deckId)}`).then((r) => json<PublishedShare[]>(r))
export const publishShare = (deckId: string) =>
	api('/shares', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deckId }) })
		.then((r) => json<PublishedShare>(r))
export const removeShare = (id: string) =>
	api(`/shares/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((r) => json<{ ok: boolean }>(r))

/** Thrown for a 409: the server holds a newer version than the one these edits build on. */
export class StaleDeckError extends Error {}

async function json<T>(res: Response): Promise<T> {
	if (res.status === 409) throw new StaleDeckError('deck changed on the server')
	if (!res.ok) {
		const body = await res.json().catch(() => null)
		throw new Error(body?.error || `${res.status} ${res.statusText}`)
	}
	return res.json() as Promise<T>
}

/** A server request; the public build has no server, so callers take their browser-only path. */
function api(path: string, init?: RequestInit): Promise<Response> {
	if (PUBLIC) return Promise.reject(new Error('no server in the public studio'))
	return fetch(`${BASE}/api${path}`, init)
}

const deckPath = (id: string) => `/decks/${encodeURIComponent(id)}`

export const listDecks = () => api('/decks').then((r) => json<DeckSummary[]>(r))
export const loadDeck = (id: string) => api(deckPath(id)).then((r) => json<Deck>(r))
export const saveDeck = (deck: Deck) =>
	api(deckPath(deck.id), {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(deck),
	}).then((r) => json<{ ok: boolean; updatedAt: number }>(r))
export const generateNotes = (id: string) =>
	api(`${deckPath(id)}/notes`, { method: 'POST' }).then((r) => json<Deck>(r))
export const saveSpeakerNotes = (
	id: string,
	slideId: string,
	notes: string,
	expectedNotes: string
) =>
	api(`${deckPath(id)}/speech`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ slideId, notes, expectedNotes }),
	}).then((r) => json<Deck>(r))
export const present = (deckId: string, slide?: number, options: PresentationOptions = {}) =>
	api('/present', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ deckId, slide, ...options }),
	})

export const redoNarration = (slideId: string) =>
	api('/redo', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ slideId }),
	}).then((r) => json<{ ok: boolean }>(r))
