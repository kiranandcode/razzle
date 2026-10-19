// `razzle-path`: an exact PPTist / library shape. The path is drawn in a viewBox of
// viewW × viewH and scaled non-uniformly to w × h, with the stroke kept at strokeWidth
// canvas px (PPTist's vector-effect: non-scaling-stroke, done by rescaling the path data).
import {
	Box,
	Group2d,
	HTMLContainer,
	Rectangle2d,
	RichTextLabel,
	RichTextSVG,
	SVGContainer,
	ShapeUtil,
	getColorValue,
	renderPlaintextFromRichText,
	resizeBox,
	useColorMode,
	useValue,
	type Editor,
	type SvgExportContext,
	type TLFontFace,
	type TLResizeInfo,
	type TLRichText,
} from 'tldraw'
import {
	RAZZLE_PATH_TYPE,
	defaultRazzlePathProps,
	razzlePathProps,
	type RazzlePathShape,
} from './razzlePathSchema'
import { scalePathData, shapeDashArray } from './svgPath'

const FONT_KEYS = new Set(['draw', 'sans', 'serif', 'mono'])

function hasText(rt: TLRichText | undefined): boolean {
	const walk = (n: any): boolean =>
		!!n && ((n.type === 'text' && !!n.text) || (Array.isArray(n.content) && n.content.some(walk)))
	return walk(rt)
}

/** A theme colour name or any CSS colour → CSS colour ('none' stays 'none'). */
function cssColor(editor: Editor, c: string, mode: 'light' | 'dark', variant: 'solid' | 'fill' = 'solid') {
	if (!c || c === 'none' || c === 'transparent') return 'none'
	return getColorValue(editor.getCurrentTheme().colors[mode], c, variant)
}

function fontFamily(editor: Editor, font: string) {
	if (FONT_KEYS.has(font)) {
		const f = (editor.getCurrentTheme().fonts as unknown as Record<string, { fontFamily: string } | undefined>)[font]
		if (f) return f.fontFamily
		return `var(--tl-font-${font})`
	}
	return font
}

/** Path data scaled into w × h (cached per shape props object). */
const scaledCache = new WeakMap<object, string>()
function scaledPath(shape: RazzlePathShape) {
	let d = scaledCache.get(shape.props)
	if (d === undefined) {
		const { path, viewW, viewH, w, h } = shape.props
		d = scalePathData(path, viewW, viewH, w, h)
		scaledCache.set(shape.props, d)
	}
	return d
}

export class RazzlePathShapeUtil extends ShapeUtil<RazzlePathShape> {
	static override type = RAZZLE_PATH_TYPE
	static override props = razzlePathProps

	override getDefaultProps(): RazzlePathShape['props'] {
		return defaultRazzlePathProps()
	}

	override canEdit() {
		return true
	}
	override canResize() {
		return true
	}
	override isAspectRatioLocked() {
		return false
	}

	override getGeometry(shape: RazzlePathShape) {
		const { w, h, fill, padding } = shape.props
		const [pt = 0, pr = 0, pb = 0, pl = 0] = padding
		return new Group2d({
			children: [
				new Rectangle2d({ width: Math.max(1, w), height: Math.max(1, h), isFilled: fill !== 'none' }),
				new Rectangle2d({
					x: pl,
					y: pt,
					width: Math.max(1, w - pl - pr),
					height: Math.max(1, h - pt - pb),
					isFilled: true,
					isLabel: true,
					excludeFromShapeBounds: true,
					isEmptyLabel: !hasText(shape.props.richText),
				}),
			],
		})
	}

	override getText(shape: RazzlePathShape) {
		return renderPlaintextFromRichText(this.editor, shape.props.richText)
	}

	override getFontFaces(shape: RazzlePathShape): TLFontFace[] {
		if (!hasText(shape.props.richText)) return []
		const f = (this.editor.getCurrentTheme().fonts as unknown as Record<string, { faces?: TLFontFace[] } | undefined>)[shape.props.font]
		return f?.faces ?? []
	}

	override onResize(shape: RazzlePathShape, info: TLResizeInfo<RazzlePathShape>) {
		return resizeBox(shape, info)
	}

	component(shape: RazzlePathShape) {
		const editor = this.editor
		const mode = useColorMode()
		const isEditing = useValue('razzle-path editing', () => editor.getEditingShapeId() === shape.id, [editor, shape.id])
		const isSelected = useValue('razzle-path selected', () => editor.getOnlySelectedShapeId() === shape.id, [editor, shape.id])
		const p = shape.props
		const stroke = cssColor(editor, p.stroke, mode)
		const showLabel = isEditing || isSelected || hasText(p.richText)
		const [pt = 0, pr = 0, pb = 0, pl = 0] = p.padding
		return (
			<>
				<SVGContainer>
					<path
						d={scaledPath(shape)}
						fill={cssColor(editor, p.fill, mode, 'solid')}
						stroke={stroke}
						strokeWidth={stroke === 'none' ? 0 : p.strokeWidth}
						strokeDasharray={shapeDashArray(p.dash, p.strokeWidth)}
						strokeLinecap="butt"
						strokeLinejoin="miter"
						strokeMiterlimit={8}
					/>
				</SVGContainer>
				{showLabel && (
					<HTMLContainer style={{ overflow: 'hidden', width: p.w, height: p.h }}>
						<RichTextLabel
							shapeId={shape.id}
							type={RAZZLE_PATH_TYPE}
							fontFamily={fontFamily(editor, p.font)}
							fontSize={p.fontSize}
							lineHeight={p.lineHeight}
							textAlign={p.align === 'middle' ? 'center' : p.align}
							verticalAlign={p.verticalAlign}
							richText={p.richText}
							labelColor={cssColor(editor, p.labelColor, mode)}
							isSelected={isSelected}
							wrap
							showTextOutline={false}
							style={{ padding: `${pt}px ${pr}px ${pb}px ${pl}px`, width: p.w, height: p.h, boxSizing: 'border-box' }}
						/>
					</HTMLContainer>
				)}
			</>
		)
	}

	override getIndicatorPath(shape: RazzlePathShape) {
		return new Path2D(scaledPath(shape))
	}

	override toSvg(shape: RazzlePathShape, ctx: SvgExportContext) {
		const p = shape.props
		const mode = ctx.colorMode
		const stroke = cssColor(this.editor, p.stroke, mode)
		const [pt = 0, pr = 0, pb = 0, pl = 0] = p.padding
		return (
			<>
				<path
					d={scaledPath(shape)}
					fill={cssColor(this.editor, p.fill, mode)}
					stroke={stroke}
					strokeWidth={stroke === 'none' ? 0 : p.strokeWidth}
					strokeDasharray={shapeDashArray(p.dash, p.strokeWidth)}
					strokeLinecap="butt"
					strokeLinejoin="miter"
					strokeMiterlimit={8}
				/>
				{hasText(p.richText) && (
					<RichTextSVG
						bounds={new Box(pl, pt, Math.max(1, p.w - pl - pr), Math.max(1, p.h - pt - pb))}
						richText={p.richText}
						fontSize={p.fontSize}
						fontFamily={fontFamily(this.editor, p.font)}
						lineHeight={p.lineHeight}
						textAlign={p.align === 'middle' ? 'center' : p.align}
						verticalAlign={p.verticalAlign}
						labelColor={cssColor(this.editor, p.labelColor, mode)}
						padding={0}
						wrap
						showTextOutline={false}
					/>
				)}
			</>
		)
	}
}
