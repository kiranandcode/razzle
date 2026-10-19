import { createContext, useContext } from 'react'
import type { Deck } from '../model/types'
import type { DeckSync } from '../model/persist'

export interface StudioContextValue {
	deck: Deck
	sync: DeckSync | null
	/** Back to the deck picker. */
	openDecks(): void
}

export const StudioContext = createContext<StudioContextValue | null>(null)

export function useStudio() {
	const v = useContext(StudioContext)
	if (!v) throw new Error('useStudio outside the studio')
	return v
}
