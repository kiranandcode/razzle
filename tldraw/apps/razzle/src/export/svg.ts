// Whole-slide SVGs for the HTML exports (reveal.js, print/PDF).
import { Editor, TLFrameShape } from 'tldraw'
import { slideNumberSvg } from '../model/SlideNumbers'
import { SlidePlan, applyStep, withExportEditor } from './exportEditor'

export interface StepSvg {
	step: number
	/** Inline-ready SVG markup: ids prefixed, @font-face rules moved to `fontCss`. */
	svg: string
}

export interface SlideSvgs {
	plan: SlidePlan
	steps: StepSvg[]
}

export interface DeckSvgs {
	slides: SlideSvgs[]
	/** Every distinct @font-face rule the slides use, once. */
	fontCss: string
	background: string
}

/** Render every planned step of every planned slide as an SVG (on an export copy of the deck). */
export async function renderDeckSvgs(editor: Editor, plans: SlidePlan[]): Promise<DeckSvgs> {
	return withExportEditor(editor, async (copy) => {
		const fonts = new Set<string>()
		const slides: SlideSvgs[] = []
		let n = 0
		for (const plan of plans) {
			const steps: StepSvg[] = []
			for (const step of plan.steps) {
				applyStep(copy, editor, plan.frame, step)
				const svg = await frameSvg(copy, plan.frame, plan.index + 1)
				steps.push({ step, svg: hoistFonts(prefixIds(svg, `rz${n++}_`), fonts) })
			}
			slides.push({ plan, steps })
		}
		const colors = copy.getCurrentTheme().colors.light
		return { slides, fontCss: [...fonts].join('\n'), background: colors.solid }
	})
}

async function frameSvg(copy: Editor, frame: TLFrameShape, number: number): Promise<string> {
	const footer = slideNumberSvg(number, frame.props.w, frame.props.h)
	const res = await copy.getSvgString([frame.id], { background: true, padding: 0, darkMode: false })
	if (!res) {
		// An empty slide: a blank page of the slide's size.
		const { w, h } = frame.props
		return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${footer}</svg>`
	}
	const transform = copy.getShapePageTransform(frame).toCssString()
	return res.svg.replace(/<\/svg>\s*$/, `<g transform="${transform}">${footer}</g></svg>`)
}

/** Make every id in one SVG unique within a page holding many SVGs. */
export function prefixIds(svg: string, prefix: string): string {
	const ids = new Set<string>()
	for (const m of svg.matchAll(/\sid="([^"]+)"/g)) ids.add(m[1])
	if (!ids.size) return svg
	const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const alt = [...ids].sort((a, b) => b.length - a.length).map(esc).join('|')
	return svg
		.replace(new RegExp(`(\\sid=")(${alt})"`, 'g'), `$1${prefix}$2"`)
		.replace(new RegExp(`url\\((&quot;|['"]?)#(${alt})\\1\\)`, 'g'), `url($1#${prefix}$2$1)`)
		.replace(new RegExp(`(href=")#(${alt})"`, 'g'), `$1#${prefix}$2"`)
}

/** Move @font-face <style> blocks out of the SVG into `fonts` (deduplicated). */
export function hoistFonts(svg: string, fonts: Set<string>): string {
	return svg.replace(/<style[^>]*>([\s\S]*?)<\/style>/g, (whole, css: string) => {
		if (!css.includes('@font-face')) return whole
		fonts.add(css.trim())
		return ''
	})
}

/** The SVG root sized to fill its box (the slide's viewBox is kept). */
export function fillBox(svg: string, cls: string): string {
	return svg.replace(/^<svg\b([^>]*)>/, (_m, attrs: string) => {
		const a = attrs
			.replace(/\swidth="[^"]*"/, '')
			.replace(/\sheight="[^"]*"/, '')
			.replace(/\sclass="([^"]*)"/, ` class="$1 ${cls}"`)
		return `<svg width="100%" height="100%"${a.includes('class="') ? a : `${a} class="${cls}"`}>`
	})
}

export const escapeHtml = (s: string) =>
	s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
