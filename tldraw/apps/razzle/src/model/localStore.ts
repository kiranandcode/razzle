// Decks kept in this browser (localStorage, one key per deck). The studio writes them when the
// server is away and, in the public build, always; the public build's screens read them back.
// Every write is announced on a BroadcastChannel so screens in this browser (other tabs, the
// speaker popup, and this window) can follow edits as they land.
import type { Deck } from './types'

export const LOCAL_PREFIX = 'razzle:deck:'
const CHANNEL = 'razzle-local-decks'

export interface LocalCopy {
	deck: Deck
	/** The server version these edits build on (undefined: never seen on the server). */
	base?: number
	/** True when the copy holds edits the server does not have. */
	unsynced: boolean
	savedAt: number
}

export interface LocalDeckWritten {
	deckId: string
	savedAt: number
}

export function readLocalDeck(id: string): LocalCopy | null {
	try {
		const raw = localStorage.getItem(LOCAL_PREFIX + id)
		return raw ? (JSON.parse(raw) as LocalCopy) : null
	} catch {
		return null
	}
}

let channel: BroadcastChannel | null | undefined
const writes = () => {
	if (channel === undefined) channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL)
	return channel
}

export function writeLocalDeck(copy: LocalCopy) {
	try {
		localStorage.setItem(LOCAL_PREFIX + copy.deck.id, JSON.stringify(copy))
	} catch {
		return false
	}
	writes()?.postMessage({ deckId: copy.deck.id, savedAt: copy.savedAt } satisfies LocalDeckWritten)
	return true
}

/** Calls `fn` whenever a deck kept in this browser is written, in this window or another. */
export function onLocalDeckWritten(fn: (w: LocalDeckWritten) => void): () => void {
	// A channel of our own: BroadcastChannel delivers to every other instance, including ones in this window.
	const ch = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL)
	if (ch) ch.onmessage = (ev) => ev.data?.deckId && fn(ev.data as LocalDeckWritten)
	// Fallback for writes the channel missed (e.g. another tab without it): the storage event.
	const onStorage = (ev: StorageEvent) => {
		if (!ev.key?.startsWith(LOCAL_PREFIX) || !ev.newValue) return
		const id = ev.key.slice(LOCAL_PREFIX.length)
		fn({ deckId: id, savedAt: readLocalDeck(id)?.savedAt ?? Date.now() })
	}
	window.addEventListener('storage', onStorage)
	return () => {
		ch?.close()
		window.removeEventListener('storage', onStorage)
	}
}

/** Decks kept in this browser (for the picker when the server is away). */
export function listLocalDecks(): { id: string; title: string; updatedAt: number; slideCount: number }[] {
	const out = []
	for (let i = 0; i < localStorage.length; i++) {
		const k = localStorage.key(i)
		if (!k?.startsWith(LOCAL_PREFIX)) continue
		const c = readLocalDeck(k.slice(LOCAL_PREFIX.length))
		if (c) out.push({ id: c.deck.id, title: c.deck.title, updatedAt: c.savedAt, slideCount: c.deck.slides?.length ?? 0 })
	}
	return out.sort((a, b) => b.updatedAt - a.updatedAt)
}
