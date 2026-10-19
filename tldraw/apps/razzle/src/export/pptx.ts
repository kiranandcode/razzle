// PPTX export (Google Slides import is the main consumer).
//
// 16:9, 10in × 5.625in: the slide's 1000 canvas px are 10in. Text, plain geo shapes and
// straight lines/arrows become native, editable PowerPoint objects; every other shape
// becomes a PNG of that shape alone, placed at its box. PPTX animations are not written
// (pptxgenjs has no animation support), so by default every build step is its own slide
// with the step's build opacities applied.
import type PptxGenJS from 'pptxgenjs'
import {
	Box,
	Editor,
	Mat,
	TLArrowShape,
	TLFrameShape,
	TLGeoShape,
	TLLineShape,
	TLShape,
	TLShapeId,
	TLTextShape,
	TLTheme,
	getArrowInfo,
	getDisplayValues,
} from 'tldraw'
import type { Deck } from '../model/types'
import { blendHex, cssToRgba, transparencyOf } from './color'
import { downloadBlob, fileStem } from './download'
import { SlidePlan, applyStep, effectiveOpacity, planSlides, withExportEditor } from './exportEditor'
import { slideNotes, stepNotes } from './notes'
import { RunStyle, richTextIsEmpty, richTextToRuns } from './richText'

export interface PptxExportOptions {
	/** 'expand' (default): one slide per build step. 'final': one slide per slide, finished. */
	builds?: 'expand' | 'final'
	/** Include hidden slides (default false). */
	includeHidden?: boolean
	/** Device pixels per canvas px for shapes exported as images (default 3 ≈ 300 dpi). */
	imagePixelRatio?: number
}

/** What became of each shape, for tests and diagnostics. */
export interface PptxExportReport {
	slides: number
	native: Record<string, number>
	image: Record<string, number>
	failed: { id: string; type: string; error: string }[]
}

const SERIF = 'Libre Baskerville'
const MONO = 'Roboto Mono'
const SANS = 'Inter'
const FALLBACK_FONTS: Record<string, string> = { draw: SERIF, serif: SERIF, sans: SANS, mono: MONO }

const NATIVE_GEO: Partial<Record<TLGeoShape['props']['geo'], string>> = {
	rectangle: 'rect',
	ellipse: 'ellipse',
	triangle: 'triangle',
	diamond: 'diamond',
}
const NATIVE_HEAD: Record<string, 'none' | 'arrow' | 'triangle' | 'oval' | 'diamond' | undefined> = {
	none: 'none',
	arrow: 'arrow',
	triangle: 'triangle',
	dot: 'oval',
	diamond: 'diamond',
}
const DASH: Record<string, 'solid' | 'dash' | 'sysDot' | undefined> = {
	draw: 'solid',
	solid: 'solid',
	dashed: 'dash',
	dotted: 'sysDot',
}

/** Build the PPTX in memory. */
export async function buildPptx(
	editor: Editor,
	deck: Deck,
	opts: PptxExportOptions = {}
): Promise<{ blob: Blob; report: PptxExportReport }> {
	const { default: PptxGenJS } = await import('pptxgenjs')
	const pptx = new PptxGenJS()
	const W = deck.width || 1000
	const H = deck.height || 562.5
	pptx.defineLayout({ name: 'RAZZLE', width: 10, height: (10 * H) / W })
	pptx.layout = 'RAZZLE'
	pptx.title = deck.title
	pptx.theme = { headFontFace: SERIF, bodyFontFace: SERIF }

	const report: PptxExportReport = { slides: 0, native: {}, image: {}, failed: [] }
	const plans = planSlides(editor, { builds: opts.builds ?? 'expand', includeHidden: opts.includeHidden })

	await withExportEditor(editor, async (copy) => {
		const ctx = new SlideWriter(copy, W, opts.imagePixelRatio ?? 3, report)
		for (const plan of plans) {
			for (const step of plan.steps) {
				applyStep(copy, editor, plan.frame, step)
				const slide = pptx.addSlide()
				await ctx.writeSlide(slide, plan, step)
				const notes = opts.builds === 'final' ? slideNotes(plan.meta) : stepNotes(plan.meta, step)
				if (notes) slide.addNotes(notes)
				report.slides++
			}
		}
	})

	const blob = (await pptx.write({ outputType: 'blob' })) as Blob
	return { blob, report }
}

/** Download the deck as `<title>.pptx`. */
export async function exportPptx(editor: Editor, deck: Deck, opts: PptxExportOptions = {}): Promise<PptxExportReport> {
	const { blob, report } = await buildPptx(editor, deck, opts)
	downloadBlob(blob, `${fileStem(deck.title)}.pptx`)
	return report
}

class SlideWriter {
	private theme: TLTheme
	private bg = 'FFFFFF'
	private toSlide = Mat.Identity()
	private frameBox = new Box()
	private images = new Map<string, { data: string; box: Box } | null>()

	constructor(
		private ed: Editor,
		private canvasW: number,
		private pixelRatio: number,
		private report: PptxExportReport
	) {
		this.theme = ed.getCurrentTheme()
	}

	private inch = (px: number) => (px * 10) / this.canvasW
	private pt = (px: number) => (px * 720) / this.canvasW
	private count(kind: 'native' | 'image', type: string) {
		this.report[kind][type] = (this.report[kind][type] ?? 0) + 1
	}

	async writeSlide(slide: PptxGenJS.Slide, plan: SlidePlan, _step: number) {
		const frame = this.ed.getShape(plan.frame.id) as TLFrameShape
		this.bg = cssToRgba(this.theme.colors.light.solid)?.hex ?? 'FFFFFF'
		slide.background = { color: this.bg }
		this.toSlide = this.ed.getShapePageTransform(frame.id)!.clone().invert()
		this.frameBox = this.ed.getShapePageBounds(frame.id)!.clone()
		await this.writeChildren(slide, frame.id)
	}

	private async writeChildren(slide: PptxGenJS.Slide, parent: TLShapeId) {
		for (const id of this.ed.getSortedChildIdsForParent(parent)) {
			const shape = this.ed.getShape(id)
			if (!shape) continue
			if (shape.type === 'group') {
				await this.writeChildren(slide, id)
				continue
			}
			const alpha = effectiveOpacity(this.ed, shape)
			if (alpha <= 0.001) continue
			try {
				if (this.writeNative(slide, shape, alpha)) {
					this.count('native', shape.type)
					continue
				}
				await this.writeImage(slide, shape, alpha)
				this.count('image', shape.type)
			} catch (e) {
				console.warn('[razzle export] shape skipped', shape.id, e)
				this.report.failed.push({ id: shape.id, type: shape.type, error: String(e) })
			}
		}
	}

	// --- native objects ---------------------------------------------------------------

	private writeNative(slide: PptxGenJS.Slide, shape: TLShape, alpha: number): boolean {
		switch (shape.type) {
			case 'text':
				return this.writeText(slide, shape as TLTextShape, alpha)
			case 'geo':
				return this.writeGeo(slide, shape as TLGeoShape, alpha)
			case 'arrow':
				return this.writeArrow(slide, shape as TLArrowShape, alpha)
			case 'line':
				return this.writeLine(slide, shape as TLLineShape, alpha)
			default:
				return false
		}
	}

	/** The shape's local box as an unrotated slide-space box (in px) plus its rotation in degrees. */
	private placed(shape: TLShape) {
		const b = this.ed.getShapeGeometry(shape.id).bounds
		const m = Mat.Compose(this.toSlide, this.ed.getShapePageTransform(shape.id)!)
		const c = Mat.applyToPoint(m, { x: b.minX + b.w / 2, y: b.minY + b.h / 2 })
		const deg = (Mat.Decompose(m).rotation * 180) / Math.PI
		return { x: c.x - b.w / 2, y: c.y - b.h / 2, w: b.w, h: b.h, rotate: norm(deg) }
	}

	private pos(p: { x: number; y: number; w: number; h: number; rotate: number }) {
		return {
			x: this.inch(p.x),
			y: this.inch(p.y),
			w: this.inch(Math.max(p.w, 0.5)),
			h: this.inch(Math.max(p.h, 0.5)),
			...(Math.abs(p.rotate) > 0.01 ? { rotate: p.rotate } : {}),
		}
	}

	private fontFace(font: string): string {
		const fam = this.theme.fonts[font as keyof TLTheme['fonts']]?.fontFamily ?? ''
		const first = fam.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '') ?? ''
		if (!first || first.startsWith('tldraw_') || first.startsWith('var(')) return FALLBACK_FONTS[font] ?? SERIF
		return first
	}

	/** Text colour at an opacity: blended with the slide background (Slides drops text alpha). */
	private textColor(css: string, alpha: number): string {
		const c = cssToRgba(css)
		if (!c) return '000000'
		return blendHex(c.hex, this.bg, c.alpha * alpha)
	}

	private runStyle(font: string, fontPx: number, lineHeight: number, color: string, align: RunStyle['align']): RunStyle {
		return {
			fontFace: this.fontFace(font),
			monoFace: this.fontFace('mono'),
			fontSize: round2(this.pt(fontPx)),
			lineSpacing: round2(this.pt(fontPx * lineHeight)),
			color,
			align,
		}
	}

	private writeText(slide: PptxGenJS.Slide, shape: TLTextShape, alpha: number): boolean {
		if (richTextIsEmpty(shape.props.richText)) return true
		const dv = getDisplayValues(this.ed.getShapeUtil(shape) as any, shape, 'light') as {
			color: string
			fontSize: number
			lineHeight: number
		}
		const align = ({ start: 'left', middle: 'center', end: 'right' } as const)[shape.props.textAlign] ?? 'left'
		const fontPx = dv.fontSize * shape.props.scale
		const runs = richTextToRuns(
			shape.props.richText,
			this.runStyle(shape.props.font, fontPx, dv.lineHeight, this.textColor(dv.color, alpha), align)
		)
		const p = this.placed(shape)
		if (shape.props.autoSize) {
			// Auto-sized text never wraps in tldraw; leave room for other renderers' metrics.
			const extra = Math.max(8, p.w * 0.08)
			if (align === 'left') p.w += extra
			else if (align === 'right') (p.x -= extra), (p.w += extra)
			else (p.x -= extra / 2), (p.w += extra)
		}
		slide.addText(runs, {
			...this.pos(p),
			margin: 0,
			valign: 'top',
			wrap: !shape.props.autoSize,
			fit: 'none',
			isTextBox: true,
			objectName: `text ${shape.id}`,
		})
		return true
	}

	private lineProps(css: string, widthPx: number, dash: string, alpha: number) {
		const c = cssToRgba(css)
		if (!c || dash === 'none') return { type: 'none' as const }
		return {
			color: c.hex,
			width: round2(this.pt(widthPx)),
			dashType: DASH[dash] ?? 'solid',
			...(c.alpha * alpha < 1 ? { transparency: transparencyOf(c.alpha * alpha) } : {}),
		}
	}

	private writeGeo(slide: PptxGenJS.Slide, shape: TLGeoShape, alpha: number): boolean {
		const prst = NATIVE_GEO[shape.props.geo]
		const { fill, dash, scale } = shape.props
		if (!prst || fill === 'pattern' || fill === 'lined-fill') return false
		const dv = getDisplayValues(this.ed.getShapeUtil(shape) as any, shape, 'light') as {
			strokeColor: string
			strokeWidth: number
			fillColor: string
			labelColor: string
			labelFontSize: number
			labelLineHeight: number
			labelPadding: number
			labelHorizontalAlign: 'start' | 'center' | 'end'
			labelVerticalAlign: 'start' | 'middle' | 'end'
		}
		const fc = fill === 'none' ? null : cssToRgba(dv.fillColor)
		const fillProps = fc
			? { color: fc.hex, ...(fc.alpha * alpha < 1 ? { transparency: transparencyOf(fc.alpha * alpha) } : {}) }
			: undefined
		const line = this.lineProps(dv.strokeColor, dv.strokeWidth * scale, dash, alpha)
		const p = this.placed(shape)
		const common = {
			...this.pos(p),
			shape: prst as PptxGenJS.ShapeType,
			line,
			...(fillProps ? { fill: fillProps } : {}),
			objectName: `geo ${shape.id}`,
		}
		if (richTextIsEmpty(shape.props.richText)) {
			slide.addShape(prst as PptxGenJS.ShapeType, common)
			return true
		}
		const align = ({ start: 'left', center: 'center', end: 'right' } as const)[dv.labelHorizontalAlign] ?? 'center'
		// The label sits on the shape's fill, itself at the shape's opacity over the slide.
		const lc = cssToRgba(dv.labelColor)
		const under = fc ? blendHex(fc.hex, this.bg, fc.alpha * alpha) : this.bg
		const labelHex = lc ? blendHex(lc.hex, under, lc.alpha * alpha) : '000000'
		const runs = richTextToRuns(
			shape.props.richText,
			this.runStyle(shape.props.font, dv.labelFontSize * scale, dv.labelLineHeight, labelHex, align)
		)
		const pad = round2(this.pt(dv.labelPadding * scale))
		slide.addText(runs, {
			...common,
			margin: pad,
			valign: ({ start: 'top', middle: 'middle', end: 'bottom' } as const)[dv.labelVerticalAlign] ?? 'middle',
			wrap: true,
			fit: 'none',
		})
		return true
	}

	private addLine(
		slide: PptxGenJS.Slide,
		a: { x: number; y: number },
		b: { x: number; y: number },
		line: Record<string, unknown>,
		name: string
	) {
		slide.addShape('line' as PptxGenJS.ShapeType, {
			x: this.inch(Math.min(a.x, b.x)),
			y: this.inch(Math.min(a.y, b.y)),
			w: this.inch(Math.abs(b.x - a.x)),
			h: this.inch(Math.abs(b.y - a.y)),
			flipH: b.x < a.x,
			flipV: b.y < a.y,
			line: line as PptxGenJS.ShapeLineProps,
			objectName: name,
		})
	}

	private writeArrow(slide: PptxGenJS.Slide, shape: TLArrowShape, alpha: number): boolean {
		if (!richTextIsEmpty(shape.props.richText)) return false
		const info = getArrowInfo(this.ed, shape)
		if (!info || !info.isValid || info.type !== 'straight') return false
		const head0 = NATIVE_HEAD[info.start.arrowhead]
		const head1 = NATIVE_HEAD[info.end.arrowhead]
		if (!head0 || !head1) return false
		const dv = getDisplayValues(this.ed.getShapeUtil(shape) as any, shape, 'light') as {
			strokeColor: string
			strokeWidth: number
		}
		const line = this.lineProps(dv.strokeColor, dv.strokeWidth * shape.props.scale, shape.props.dash, alpha)
		if ('type' in line) return true
		const m = Mat.Compose(this.toSlide, this.ed.getShapePageTransform(shape.id)!)
		const a = Mat.applyToPoint(m, info.start.point)
		const b = Mat.applyToPoint(m, info.end.point)
		this.addLine(
			slide,
			a,
			b,
			{
				...line,
				...(head0 !== 'none' ? { beginArrowType: head0 } : {}),
				...(head1 !== 'none' ? { endArrowType: head1 } : {}),
			},
			`arrow ${shape.id}`
		)
		return true
	}

	private writeLine(slide: PptxGenJS.Slide, shape: TLLineShape, alpha: number): boolean {
		const pts = Object.values(shape.props.points).sort((a, b) => (a.index < b.index ? -1 : 1))
		if (pts.length !== 2) return false
		const dv = getDisplayValues(this.ed.getShapeUtil(shape) as any, shape, 'light') as {
			strokeColor: string
			strokeWidth: number
		}
		const line = this.lineProps(dv.strokeColor, dv.strokeWidth * shape.props.scale, shape.props.dash, alpha)
		if ('type' in line) return true
		const m = Mat.Compose(this.toSlide, this.ed.getShapePageTransform(shape.id)!)
		this.addLine(slide, Mat.applyToPoint(m, pts[0]), Mat.applyToPoint(m, pts[1]), line, `line ${shape.id}`)
		return true
	}

	// --- images -----------------------------------------------------------------------

	private async writeImage(slide: PptxGenJS.Slide, shape: TLShape, alpha: number) {
		const key = `${shape.id}@${alpha.toFixed(4)}`
		let img = this.images.get(key)
		if (img === undefined) {
			img = await this.renderImage(shape)
			this.images.set(key, img)
		}
		if (!img) return
		const tl = Mat.applyToPoint(this.toSlide, { x: img.box.x, y: img.box.y })
		slide.addImage({
			data: img.data,
			x: this.inch(tl.x),
			y: this.inch(tl.y),
			w: this.inch(img.box.w),
			h: this.inch(img.box.h),
			altText: altText(this.ed, shape),
			objectName: `${shape.type} ${shape.id}`,
		})
	}

	/** A PNG of one shape (with its descendants, for a nested frame), clipped to the slide. */
	private async renderImage(shape: TLShape): Promise<{ data: string; box: Box } | null> {
		const ids = [shape.id, ...this.ed.getShapeAndDescendantIds([shape.id])].filter(
			(id, i, all) => all.indexOf(id) === i
		)
		const page = this.ed.getShapePageBounds(shape.id)
		if (!page) return null
		// Room for strokes and arrowheads; a frame's name label sits above its box.
		const margin = 12
		const box = page.clone().expandBy(margin)
		if (this.ed.isShapeFrameLike(shape)) (box.y -= 32), (box.h += 32)
		const clipped = intersect(box, this.frameBox)
		if (!clipped || clipped.w < 1 || clipped.h < 1) return null
		// More than one id keeps a nested frame drawn as itself (a lone frame exports only its contents).
		const exportIds = ids.length === 1 && this.ed.isShapeFrameLike(shape) ? [shape.id, shape.id] : ids
		const res = await this.ed.toImage(exportIds, {
			format: 'png',
			bounds: clipped,
			padding: 0,
			background: false,
			darkMode: false,
			pixelRatio: this.pixelRatio,
		})
		const data = await blobToDataUrl(res.blob)
		return { data, box: clipped }
	}
}

function intersect(a: Box, b: Box): Box | null {
	const x0 = Math.max(a.minX, b.minX)
	const y0 = Math.max(a.minY, b.minY)
	const x1 = Math.min(a.maxX, b.maxX)
	const y1 = Math.min(a.maxY, b.maxY)
	return x1 > x0 && y1 > y0 ? new Box(x0, y0, x1 - x0, y1 - y0) : null
}

function altText(ed: Editor, shape: TLShape): string {
	try {
		return ed.getShapeUtil(shape).getText(shape) || shape.type
	} catch {
		return shape.type
	}
}

function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const r = new FileReader()
		r.onload = () => resolve(r.result as string)
		r.onerror = () => reject(r.error)
		r.readAsDataURL(blob)
	})
}

const round2 = (n: number) => Math.round(n * 100) / 100
const norm = (deg: number) => {
	let d = deg % 360
	if (d > 180) d -= 360
	if (d <= -180) d += 360
	return Math.round(d * 100) / 100
}

