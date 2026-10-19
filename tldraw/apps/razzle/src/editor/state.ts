// Studio UI state shared by the panels (signals, so `useValue` and computeds can read them).
import { atom } from 'tldraw'

export type InspectorTab = 'builds' | 'speech'

/** The right-hand inspector: which tab is open, or null when closed. */
export const $inspector = atom<InspectorTab | null>('inspector', null)
/** The library drawer on the left. */
export const $libraryOpen = atom('library open', false)
/** Build preview: the step being previewed on the current slide, or null when not previewing. */
export const $previewStep = atom<number | null>('preview step', null)
/** Slide the slides panel last navigated to (used before anything is selected). */
export const $focusSlide = atom<string | null>('focus slide', null)
