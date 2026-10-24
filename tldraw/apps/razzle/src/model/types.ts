// The Razzle deck model on tldraw (docs/DESIGN.md, "Studio").
//
// A deck is one tldraw document. Every frame at the root of the first page is a
// slide; slides are ordered by reading position on the canvas (top to bottom,
// then left to right). Per-slide speech lives in the frame's `meta.razzle`;
// build steps live in each shape's `meta.build`.
import type { TLStoreSnapshot } from 'tldraw'

export interface RazzleCue {
	id: string
	/** Spoken phrase that fires the action, matched case-insensitively on word boundaries. */
	phrase: string
	/** 'next' advances to the next slide; 'step' plays the next build step. */
	action: 'next' | 'step'
	/** Only armed while the slide is at this build step; omitted = armed at any step. */
	atStep?: number
}

/** `frame.meta.razzle` */
export interface RazzleSlideMeta {
	/** Skipped by next/prev; reached by an explicit jump (speaker view or agent). */
	hidden?: boolean
	/** What the speaker means to say, one entry per build step (index = step). */
	script?: string[]
	cues?: RazzleCue[]
	/** In auto-present, advance once the script for the last step has been covered. Default true. */
	autoAdvance?: boolean
	/** Set on slides the live agent authored during a talk. */
	generated?: { by: string; prompt: string; at: number }
	/** Speaker notes (HTML). */
	notes?: string
	notesEditedAt?: number
	rehearsal?: { takeIds: string[]; updatedAt: number }
}

/**
 * `shape.meta.build`: how a shape takes part in the slide's build steps.
 * Step 0 is the slide as it first appears. A shape (or a group, for all its
 * members) with `step: k` changes at step k:
 *  - appear:    hidden before k, shown from k
 *  - fade:      faded (FADED_OPACITY) before k, full from k (the "not yet" grey of the talks)
 *  - disappear: shown before k, hidden from k
 * With `until: m` (m > k) the effect holds only for steps k..m-1 and the shape returns
 * to its state before k from step m on (appear: hidden again, fade: faded again,
 * disappear: shown again).
 * A shape inside groups shows the product of its own build and each group's build.
 */
export interface BuildMeta {
	step: number
	effect: 'appear' | 'fade' | 'disappear'
	until?: number
}

export const FADED_OPACITY = 0.22

/** One slide as the server and director see it (derived; written on every save). */
export interface SlideIndex {
	/** The frame's shape id. */
	id: string
	title: string
	razzle: RazzleSlideMeta
	stepCount: number
	/** Shapes on the slide with their text and box, in slide coordinates (frame top-left = 0,0). */
	elements: SlideElement[]
}

export interface SlideElement {
	id: string
	type: string
	text: string
	left: number
	top: number
	width: number
	height: number
	rotate: number
	build?: BuildMeta
}

export const DECK_FORMAT = 'razzle-tldraw/1'

export interface Deck {
	id: string
	title: string
	format: typeof DECK_FORMAT
	/** Slide (frame) size in canvas units. */
	width: number
	height: number
	/** The tldraw document (`getSnapshot(store).document`). Source of truth. */
	document: TLStoreSnapshot
	/** Derived from `document` on every save, for the server and director. */
	slides: SlideIndex[]
	updatedAt?: number
}

export const SLIDE_W = 1000
export const SLIDE_H = 562.5
