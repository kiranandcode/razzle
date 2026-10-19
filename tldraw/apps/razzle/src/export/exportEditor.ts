// A throwaway editor over a copy of the deck, so exports can apply build opacities
// without touching the user's document (docs/DESIGN.md, "Studio": build opacities are
// applied in memory, never saved).
import {
	Editor,
	TLAnyBindingUtilConstructor,
	TLAnyShapeUtilConstructor,
	TLFrameShape,
	TLShape,
	TLShapeId,
	TLShapePartial,
	atom,
	coreShapes,
	createTLCurrentUser,
	createTLStore,
} from 'tldraw'
import { buildOf, buildOpacity, getSlides, isHidden, slideMeta, slideShapes, stepCount } from '../model/slides'
import type { RazzleSlideMeta } from '../model/types'

/** Which build steps of a slide an export renders. */
export type BuildsMode = 'expand' | 'final'

export interface SlidePlan {
	frame: TLFrameShape
	index: number
	title: string
	hidden: boolean
	meta: RazzleSlideMeta
	stepCount: number
	/** The build steps this export renders, in order. */
	steps: number[]
}

/**
 * Run `fn` against a headless editor holding a copy of `editor`'s document, then dispose it.
 * The copy uses the live editor's shape/binding utils, themes, fonts, text options and
 * asset store, and renders exports into the live editor's container (so tldraw's CSS applies).
 */
export async function withExportEditor<T>(editor: Editor, fn: (copy: Editor) => Promise<T>): Promise<T> {
	const shapeUtils = Object.values(editor.shapeUtils)
		.map((u) => u!.constructor as TLAnyShapeUtilConstructor)
		.filter((u) => !coreShapes.some((c) => c.type === u.type)) // the Editor adds core shapes itself
	const bindingUtils = Object.values(editor.bindingUtils).map(
		(u) => u!.constructor as TLAnyBindingUtilConstructor
	)
	const store = createTLStore({
		schema: editor.store.schema,
		snapshot: editor.store.getStoreSnapshot('document'),
		assets: editor.store.props.assets,
		defaultName: editor.store.props.defaultName,
		// Colour/font registration is global in tldraw: without the live themes this would
		// unregister the deck's custom colours for every editor on the page.
		themes: editor.getThemes(),
		onMount: () => {},
	})
	const prefs = atom('razzle-export-user', { ...editor.user.getUserPreferences(), colorScheme: 'light' as const })
	const copy = new Editor({
		store,
		shapeUtils,
		bindingUtils,
		tools: [],
		getContainer: () => editor.getContainer(),
		user: createTLCurrentUser({ userPreferences: prefs, setUserPreferences: () => {} }),
		colorScheme: 'light',
		options: { ...editor.options, text: editor.getTextOptions() ?? undefined },
		themes: editor.getThemes(),
		initialTheme: editor.getCurrentThemeId(),
		// FontManager keeps the live editor's asset url map private; the copy needs the same map.
		fontAssetUrls: (editor.fonts as any).assetUrls,
	})
	try {
		const page = editor.getCurrentPageId()
		if (copy.getPage(page)) copy.setCurrentPage(page)
		return await fn(copy)
	} finally {
		copy.dispose()
	}
}

/** The slides an export renders, in reading order. */
export function planSlides(
	editor: Editor,
	opts: { builds?: BuildsMode; includeHidden?: boolean } = {}
): SlidePlan[] {
	const builds = opts.builds ?? 'expand'
	return getSlides(editor)
		.map((frame, index) => {
			const n = stepCount(editor, frame)
			return {
				frame,
				index,
				title: frame.props.name,
				hidden: isHidden(frame),
				meta: slideMeta(frame),
				stepCount: n,
				steps: builds === 'expand' ? [...Array(n).keys()] : [n - 1],
			}
		})
		.filter((s) => opts.includeHidden || !s.hidden)
}

/**
 * Set every shape on the slide to its opacity at `step` (original opacity × build
 * opacity). Only for an export copy: the originals are read from `original`.
 */
export function applyStep(copy: Editor, original: Editor, frame: TLShape, step: number) {
	const updates: TLShapePartial[] = []
	for (const s of slideShapes(original, frame)) {
		if (s.type === 'group') continue
		const opacity = s.opacity * buildOpacity(buildOf(original, s), step)
		const cur = copy.getShape(s.id)
		if (cur && cur.opacity !== opacity) updates.push({ id: s.id, type: s.type, opacity })
	}
	if (updates.length) copy.run(() => copy.updateShapes(updates), { history: 'ignore' })
}

/** A shape's opacity as rendered: its own times every ancestor's (below the page). */
export function effectiveOpacity(editor: Editor, shape: TLShape): number {
	let o = 1
	let s: TLShape | undefined = shape
	while (s) {
		o *= s.opacity
		s = editor.getShape(s.parentId as TLShapeId)
	}
	return o
}
