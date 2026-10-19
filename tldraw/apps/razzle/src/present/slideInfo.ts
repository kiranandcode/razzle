// What the screens need to know about each slide, read once per deck load from
// a presenting editor (docs/DESIGN.md, "Studio": the document is the source of truth).
import type { Editor, TLFrameShape, TLShape } from 'tldraw'
import { getSlides, slideMeta, stepCount } from '../model/slides'
import type { BuildMeta, RazzleSlideMeta } from '../model/types'

/** `frame.meta.razzle` plus the fields the converter adds for the screens. */
export interface PresentSlideMeta extends RazzleSlideMeta {
	/** Speaker notes as HTML. */
	notes?: string
}

export interface SlideInfo {
	id: TLFrameShape['id']
	index: number
	title: string
	hidden: boolean
	stepCount: number
	meta: PresentSlideMeta
}

export function readSlides(editor: Editor): SlideInfo[] {
	return getSlides(editor).map((frame, index) => {
		const meta = slideMeta(frame) as PresentSlideMeta
		return {
			id: frame.id,
			index,
			title: frame.props.name,
			hidden: !!meta.hidden,
			stepCount: stepCount(editor, frame),
			meta,
		}
	})
}

/**
 * A shape's own build (not inherited). tldraw multiplies a shape's opacity by
 * its ancestors' when rendering, so setting the build opacity on the shape that
 * carries the build (a group, say) applies it to every member exactly once.
 */
export function ownBuild(shape: TLShape): BuildMeta | undefined {
	const b = (shape.meta as any)?.build as BuildMeta | undefined
	return b && Number.isInteger(b.step) && b.step >= 1 ? b : undefined
}

/** First and last positions a linear walk can reach (hidden slides skipped). */
export function firstPos(slides: SlideInfo[]) {
	const s = slides.find((x) => !x.hidden)
	return s ? { slide: s.index, step: 0 } : null
}

export function lastPos(slides: SlideInfo[]) {
	for (let i = slides.length - 1; i >= 0; i--) {
		if (!slides[i].hidden) return { slide: i, step: slides[i].stepCount - 1 }
	}
	return null
}
