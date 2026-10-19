// Record shape of `razzle-path`: an SVG path drawn in a viewBox and scaled to w × h
// (non-uniformly, like PPTist shapes), with an optional rich-text label.
// Kept apart from the util so headless tools can validate records without React.
import { T, richTextValidator, type RecordProps, type TLRichText, type TLShape } from 'tldraw'

export const RAZZLE_PATH_TYPE = 'razzle-path'

export type RazzleAlign = 'start' | 'middle' | 'end'

export interface RazzlePathProps {
	w: number
	h: number
	/** SVG path data in viewBox units (absolute or relative commands). */
	path: string
	viewW: number
	viewH: number
	/** CSS colour, a theme colour name, or 'none'. */
	fill: string
	/** CSS colour, a theme colour name, or 'none'. */
	stroke: string
	/** Stroke width in canvas px (not scaled with the viewBox). */
	strokeWidth: number
	/** 'solid' | 'dashed' | 'dotted' or an SVG dasharray. */
	dash: string
	/** Label, centred by default. Empty doc = no label. */
	richText: TLRichText
	/** 'serif' | 'sans' | 'mono' (theme fonts) or a CSS font family. */
	font: string
	/** Label font size in canvas px. */
	fontSize: number
	/** CSS colour or theme colour name. */
	labelColor: string
	align: RazzleAlign
	verticalAlign: RazzleAlign
	lineHeight: number
	/** Label inset [top, right, bottom, left] in canvas px. */
	padding: number[]
}

declare module 'tldraw' {
	export interface TLGlobalShapePropsMap {
		[RAZZLE_PATH_TYPE]: RazzlePathProps
	}
}

export type RazzlePathShape = TLShape<typeof RAZZLE_PATH_TYPE>

const align = T.literalEnum('start', 'middle', 'end')

export const razzlePathProps: RecordProps<RazzlePathShape> = {
	w: T.positiveNumber,
	h: T.positiveNumber,
	path: T.string,
	viewW: T.positiveNumber,
	viewH: T.positiveNumber,
	fill: T.string,
	stroke: T.string,
	strokeWidth: T.number,
	dash: T.string,
	richText: richTextValidator,
	font: T.string,
	fontSize: T.positiveNumber,
	labelColor: T.string,
	align,
	verticalAlign: align,
	lineHeight: T.positiveNumber,
	padding: T.arrayOf(T.number),
}

export const EMPTY_RICH_TEXT: TLRichText = { type: 'doc', content: [{ type: 'paragraph' }] }

export function defaultRazzlePathProps(): RazzlePathProps {
	return {
		w: 100,
		h: 100,
		path: 'M 0 0 L 100 0 L 100 100 L 0 100 Z',
		viewW: 100,
		viewH: 100,
		fill: '#eeeeee',
		stroke: 'none',
		strokeWidth: 2,
		dash: 'solid',
		richText: EMPTY_RICH_TEXT,
		font: 'serif',
		fontSize: 19,
		labelColor: '#000000',
		align: 'middle',
		verticalAlign: 'middle',
		lineHeight: 1.3,
		padding: [10, 10, 10, 10],
	}
}
