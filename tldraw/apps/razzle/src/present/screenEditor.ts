// What every screen editor shares: the Razzle theme and shapes, a private
// light-mode user, no UI, and a store holding the deck document.
import {
	TLComponents,
	TLShape,
	TLShapeId,
	atom,
	createTLCurrentUser,
	createTLStore,
	defaultBindingUtils,
	defaultShapeUtils,
	loadSnapshot,
} from 'tldraw'
import { shapeUtils } from '../shapes'
import * as theme from '../theme'
import type { Deck } from '../model/types'

// Read through the namespace so the screens keep working while the theme module grows.
const themeProps: Record<string, any> = (theme as Record<string, any>).tldrawThemeProps ?? {}

const allShapeUtils = [...defaultShapeUtils, ...shapeUtils]

// Slides always render light, whatever the studio's colour scheme is, and the
// screens never animate or take tldraw shortcuts. Private: never written to
// the studio's stored preferences.
const presentUser = createTLCurrentUser({
	userPreferences: atom('razzle-present-user', {
		id: 'razzle-present',
		colorScheme: 'light' as const,
		animationSpeed: 0,
		areKeyboardShortcutsEnabled: false,
	}),
	setUserPreferences: () => {},
})

const components: TLComponents = { Background: null, Grid: null }

/** A store holding the deck document, for a screen's private editor. */
export function makeStore(deck: Deck) {
	// `themes` registers the Razzle colour and font names the document uses before it is validated
	const s = createTLStore({ shapeUtils: allShapeUtils, bindingUtils: defaultBindingUtils, themes: themeProps.themes })
	if (deck.document) loadSnapshot(s, deck.document)
	return s
}

/** Props every screen editor shares (theme, private light-mode user, no UI). */
export const screenEditorProps = {
	...themeProps,
	shapeUtils,
	user: presentUser,
	colorScheme: 'light' as const,
	hideUi: true,
	autoFocus: false,
	components,
}

export function rememberOpacities(records: TLShape[], into: Map<TLShapeId, number>) {
	for (const r of records) if ((r as any).typeName === 'shape') into.set(r.id, r.opacity)
}
