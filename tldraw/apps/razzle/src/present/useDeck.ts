// The deck a presentation window shows. Loaded once, then reloaded when the
// server says it changed (`deck-updated`) or a generated hidden slide landed
// (`hidden-ready`, normally preceded by `deck-updated`; reload anyway).
// Every successful load bumps `version`; stages reload their store on it.
// The public build has no server: the deck is the copy the studio keeps in this browser
// (`deck-updated` then comes from the in-browser presenter when the studio saves).
import { useEffect, useRef, useState } from 'react'
import { PUBLIC } from '../model/base'
import { on } from '../model/client'
import { loadDeck } from '../model/deck'
import { readLocalDeck } from '../model/localStore'
import type { Deck } from '../model/types'

async function fetchDeck(id: string): Promise<Deck> {
	if (!PUBLIC) return loadDeck(id)
	const copy = readLocalDeck(id)
	if (!copy) throw new Error('this browser has no copy of the deck; open it in the studio first')
	return { ...copy.deck, updatedAt: copy.savedAt }
}

export interface LoadedDeck {
	deck: Deck | null
	version: number
	error: string | null
}

export function useDeck(deckId: string | null): LoadedDeck {
	const [loaded, setLoaded] = useState<LoadedDeck>({ deck: null, version: 0, error: null })
	const lastUpdatedAt = useRef(0)

	useEffect(() => {
		if (!deckId) return
		let alive = true
		let inflight = false
		let again = false

		const reload = (updatedAt?: number) => {
			if (updatedAt && updatedAt <= lastUpdatedAt.current) return
			if (inflight) {
				again = true
				return
			}
			inflight = true
			fetchDeck(deckId)
				.then((deck) => {
					if (!alive) return
					lastUpdatedAt.current = deck.updatedAt ?? Date.now()
					setLoaded((prev) => ({ deck, version: prev.version + 1, error: null }))
				})
				.catch((err) => {
					if (alive) setLoaded((prev) => ({ ...prev, error: String(err?.message ?? err) }))
				})
				.finally(() => {
					inflight = false
					if (again && alive) {
						again = false
						reload()
					}
				})
		}

		reload()
		const offs = [
			on('deck-updated', (msg) => {
				if (msg.deckId === deckId) reload(msg.updatedAt)
			}),
			on('hidden-ready', () => reload()),
		]
		return () => {
			alive = false
			offs.forEach((off) => off())
		}
	}, [deckId])

	return loaded
}
