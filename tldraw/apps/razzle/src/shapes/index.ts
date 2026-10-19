// Custom shape utils every Razzle editor instance registers (studio, screens, export).
// Owned by the converter/library work.
//
//  - `shapeUtils`: custom shape types (schema-relevant): `razzle-path`, the exact PPTist /
//    library shape. Pass to createTLStore({ shapeUtils: [...defaultShapeUtils, ...shapeUtils] })
//    and to <Tldraw shapeUtils>.
//  - `editorShapeUtils`: `shapeUtils` plus configured versions of tldraw's text, arrow, line
//    and geo utils (no text halo) that honour `shape.meta.exact` (written by the PPTist converter): the exact
//    PPTist colour while `props.color` is still the palette colour it was mapped to, and
//    the exact line height of a text. Pass to <Tldraw shapeUtils> (tldraw replaces its
//    defaults by type); never to createTLStore together with defaultShapeUtils (duplicate
//    types throw there, and the schema is the same either way).
import {
	ArrowShapeUtil,
	GeoShapeUtil,
	LineShapeUtil,
	TextShapeUtil,
	type TLAnyShapeUtilConstructor,
	type TLShape,
} from 'tldraw'
import { RazzlePathShapeUtil } from './RazzlePathShapeUtil'

export { RazzlePathShapeUtil } from './RazzlePathShapeUtil'
export { RAZZLE_PATH_TYPE, type RazzlePathShape, type RazzlePathProps } from './razzlePathSchema'

export const shapeUtils: TLAnyShapeUtilConstructor[] = [RazzlePathShapeUtil]

/** `shape.meta.exact`: exact PPTist values behind a palette approximation. */
export interface ExactMeta {
	/** The exact colour (#rrggbb) … */
	color?: string
	/** … used while props.color is still this palette name. */
	of?: string
	/** Text line height (multiple of the font size). */
	lineHeight?: number
}

function exactOf(shape: TLShape): ExactMeta | undefined {
	const x = (shape.meta as any)?.exact
	return x && typeof x === 'object' ? (x as ExactMeta) : undefined
}

function exactColor(shape: TLShape): string | undefined {
	const x = exactOf(shape)
	return x?.color && x.of === (shape.props as any).color ? x.color : undefined
}

const RazzleTextShapeUtil = TextShapeUtil.configure({
	showTextOutline: false,
	getCustomDisplayValues(_editor, shape) {
		const x = exactOf(shape)
		const color = exactColor(shape)
		return {
			...(color ? { color } : {}),
			...(x?.lineHeight ? { lineHeight: x.lineHeight } : {}),
		}
	},
})

const RazzleArrowShapeUtil = ArrowShapeUtil.configure({
	getCustomDisplayValues(_editor, shape) {
		const color = exactColor(shape)
		return color ? { strokeColor: color } : {}
	},
})

const RazzleLineShapeUtil = LineShapeUtil.configure({
	getCustomDisplayValues(_editor, shape) {
		const color = exactColor(shape)
		return color ? { strokeColor: color } : {}
	},
})

export const editorShapeUtils: TLAnyShapeUtilConstructor[] = [
	...shapeUtils,
	RazzleTextShapeUtil,
	RazzleArrowShapeUtil,
	RazzleLineShapeUtil,
	// slides are white paper: no halo around geo labels
	GeoShapeUtil.configure({ showTextOutline: false }),
]
