// Slides, build steps and the derived slide index over a tldraw editor.
import { Editor, TLFrameShape, TLShape, TLShapeId } from 'tldraw'
import { BuildMeta, FADED_OPACITY, RazzleSlideMeta, SlideElement, SlideIndex } from './types'

const ROW_TOLERANCE = 40

/** Frames at the root of the current page, in reading order. */
export function getSlides(editor: Editor): TLFrameShape[] {
	const frames = editor
		.getSortedChildIdsForParent(editor.getCurrentPageId())
		.map((id) => editor.getShape(id))
		.filter((s): s is TLFrameShape => s?.type === 'frame')
	return frames.sort((a, b) => (Math.abs(a.y - b.y) > ROW_TOLERANCE ? a.y - b.y : a.x - b.x))
}

export function slideMeta(frame: TLShape): RazzleSlideMeta {
	return ((frame.meta as any)?.razzle ?? {}) as RazzleSlideMeta
}

export function isHidden(frame: TLShape) {
	return !!slideMeta(frame).hidden
}

/** The build of a shape: its own, else the nearest group ancestor's (below the slide). */
export function buildOf(editor: Editor, shape: TLShape): BuildMeta | undefined {
	let s: TLShape | undefined = shape
	while (s && s.type !== 'frame') {
		const b = (s.meta as any)?.build as BuildMeta | undefined
		if (b && Number.isInteger(b.step) && b.step >= 1) return b
		s = editor.getShape(s.parentId as TLShapeId)
	}
	return undefined
}

/** Every shape on a slide (all descendants of the frame). */
export function slideShapes(editor: Editor, frame: TLShape): TLShape[] {
	return [...editor.getShapeAndDescendantIds([frame.id])]
		.filter((id) => id !== frame.id)
		.map((id) => editor.getShape(id)!)
		.filter(Boolean)
}

/** Number of build steps: step 0 plus the highest step any shape changes at. */
export function stepCount(editor: Editor, frame: TLShape): number {
	let max = 0
	for (const s of slideShapes(editor, frame)) {
		const b = (s.meta as any)?.build as BuildMeta | undefined
		if (b && Number.isInteger(b.step) && b.step > max) max = b.step
	}
	return max + 1
}

/** Opacity multiplier for a build at a step: 0 hidden, FADED_OPACITY faded, 1 shown. */
export function buildOpacity(build: BuildMeta | undefined, step: number): number {
	if (!build) return 1
	const reached = step >= build.step
	switch (build.effect) {
		case 'appear':
			return reached ? 1 : 0
		case 'fade':
			return reached ? 1 : FADED_OPACITY
		case 'disappear':
			return reached ? 0 : 1
	}
}

/** Position of `next`/`prev` from (slide, step), skipping hidden slides. Null at the ends. */
export function movePosition(
	slides: { hidden: boolean; stepCount: number }[],
	pos: { slide: number; step: number },
	dir: 1 | -1
): { slide: number; step: number } | null {
	if (dir === 1 && pos.step < slides[pos.slide].stepCount - 1) return { slide: pos.slide, step: pos.step + 1 }
	if (dir === -1 && pos.step > 0) return { slide: pos.slide, step: pos.step - 1 }
	for (let i = pos.slide + dir; i >= 0 && i < slides.length; i += dir) {
		if (!slides[i].hidden) return { slide: i, step: dir === 1 ? 0 : slides[i].stepCount - 1 }
	}
	return null
}

/** The slide index the server and director read (types.ts, SlideIndex). */
export function buildSlideIndex(editor: Editor): SlideIndex[] {
	return getSlides(editor).map((frame) => {
		const origin = editor.getShapePageTransform(frame.id)!
		const elements: SlideElement[] = []
		for (const s of slideShapes(editor, frame)) {
			if (s.type === 'group') continue
			const b = editor.getShapePageBounds(s.id)
			if (!b) continue
			const tl = origin.clone().invert().applyToPoint({ x: b.x, y: b.y })
			elements.push({
				id: s.id,
				type: s.type,
				text: editor.getShapeUtil(s).getText(s) ?? '',
				left: tl.x,
				top: tl.y,
				width: b.w,
				height: b.h,
				rotate: (editor.getShapePageTransform(s.id)!.rotation() * 180) / Math.PI,
				build: buildOf(editor, s),
			})
		}
		return {
			id: frame.id,
			title: frame.props.name,
			razzle: slideMeta(frame),
			stepCount: stepCount(editor, frame),
			elements,
		}
	})
}
