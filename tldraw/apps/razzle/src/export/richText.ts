// tldraw rich text (TipTap JSON) → pptxgenjs text runs.
import type PptxGenJS from 'pptxgenjs'
import type { TLRichText } from 'tldraw'

type Run = PptxGenJS.TextProps
type RunOpts = NonNullable<Run['options']>

interface Node {
	type: string
	text?: string
	attrs?: Record<string, any>
	marks?: { type: string; attrs?: Record<string, any> }[]
	content?: Node[]
}

export interface RunStyle {
	fontFace: string
	monoFace: string
	fontSize: number // pt
	color: string // hex
	lineSpacing: number // pt
	align: 'left' | 'center' | 'right'
}

/**
 * Paragraphs of runs. pptxgenjs starts a new paragraph after a run with `breakLine`;
 * paragraph options (align, bullet, indent) are read from the paragraph's first run.
 */
export function richTextToRuns(richText: TLRichText | undefined, style: RunStyle): Run[] {
	const paras: Run[][] = []
	const base: RunOpts = {
		fontFace: style.fontFace,
		fontSize: style.fontSize,
		color: style.color,
		align: style.align,
		lineSpacing: style.lineSpacing,
	}

	const inline = (nodes: Node[] | undefined, para: RunOpts): Run[] => {
		const runs: Run[] = []
		let soft = false
		for (const n of nodes ?? []) {
			if (n.type === 'text' && n.text) {
				const o: RunOpts = { ...base, ...para }
				if (soft) o.softBreakBefore = true
				soft = false
				for (const m of n.marks ?? []) {
					if (m.type === 'bold') o.bold = true
					else if (m.type === 'italic') o.italic = true
					else if (m.type === 'strike') o.strike = 'sngStrike'
					else if (m.type === 'underline') o.underline = { style: 'sng' }
					else if (m.type === 'code') o.fontFace = style.monoFace
					else if (m.type === 'link' && m.attrs?.href) o.hyperlink = { url: m.attrs.href }
					else if (m.type === 'highlight') o.highlight = 'FFF176'
				}
				runs.push({ text: n.text, options: o })
			} else if (n.type === 'hardBreak') {
				if (soft) runs.push({ text: '', options: { ...base, ...para, softBreakBefore: true } })
				soft = true
			}
		}
		if (soft) runs.push({ text: '', options: { ...base, ...para, softBreakBefore: true } })
		return runs
	}

	const block = (n: Node, para: RunOpts, depth: number) => {
		switch (n.type) {
			case 'paragraph':
			case 'heading': {
				const extra: RunOpts = n.type === 'heading' ? { bold: true } : {}
				if (n.attrs?.textAlign) para = { ...para, align: alignOf(n.attrs.textAlign, style.align) }
				const runs = inline(n.content, { ...para, ...extra })
				paras.push(runs.length ? runs : [{ text: '', options: { ...base, ...para } }])
				return
			}
			case 'bulletList':
			case 'orderedList': {
				const numbered = n.type === 'orderedList'
				for (const item of n.content ?? []) {
					let first = true
					for (const child of item.content ?? []) {
						if (child.type === 'bulletList' || child.type === 'orderedList') {
							block(child, para, depth + 1)
							continue
						}
						const p: RunOpts = first
							? {
									...para,
									bullet: numbered ? { type: 'number' } : true,
									indentLevel: depth,
								}
							: { ...para, indentLevel: depth }
						block(child, p, depth)
						first = false
					}
				}
				return
			}
			case 'codeBlock': {
				const text = (n.content ?? []).map((c) => c.text ?? '').join('')
				for (const line of text.split('\n'))
					paras.push([{ text: line, options: { ...base, ...para, fontFace: style.monoFace } }])
				return
			}
			case 'blockquote':
			default:
				for (const c of n.content ?? []) block(c, para, depth)
		}
	}

	const doc = richText as unknown as Node | undefined
	for (const n of doc?.content ?? []) block(n, {}, 0)

	// Paragraph options belong on the first run; the paragraph ends with breakLine.
	const out: Run[] = []
	paras.forEach((runs, i) => {
		const last = i === paras.length - 1
		runs.forEach((r, j) => {
			const o = { ...r.options }
			if (j === runs.length - 1 && !last) o.breakLine = true
			out.push({ text: r.text, options: o })
		})
	})
	return out
}

function alignOf(a: string, dflt: RunStyle['align']): RunStyle['align'] {
	if (a === 'center' || a === 'middle') return 'center'
	if (a === 'right' || a === 'end') return 'right'
	if (a === 'left' || a === 'start') return 'left'
	return dflt
}

/** Plain text of rich text (for empty checks). */
export function richTextIsEmpty(richText: TLRichText | undefined): boolean {
	const walk = (n: Node): boolean => (n.text ? n.text.trim() === '' : (n.content ?? []).every(walk))
	return !richText || walk(richText as unknown as Node)
}
