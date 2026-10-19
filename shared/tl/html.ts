// PPTist rich-text HTML (ProseMirror output: <p>, <span style>, <strong>, <em>, <u>, <s>,
// <ul>/<ol>/<li>, <br>) → paragraphs of styled runs, and → TipTap JSON for tldraw.
// No DOM: a small tag tokenizer, enough for what PPTist and the kit write.

export interface Run {
	text: string
	bold?: boolean
	italic?: boolean
	underline?: boolean
	strike?: boolean
	code?: boolean
	color?: string
	size?: number
	font?: string
	bg?: string
	href?: string
}

export interface Para {
	align: 'left' | 'center' | 'right' | 'justify'
	runs: Run[]
	list?: 'bullet' | 'ordered'
	/** Index of the list this paragraph belongs to (consecutive items share one). */
	listId?: number
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', '#39': "'" }
export function decodeEntities(s: string): string {
	return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
		if (e[0] === '#') {
			const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
			return Number.isFinite(n) ? String.fromCodePoint(n) : m
		}
		return ENT[e.toLowerCase()] ?? m
	})
}

function styleOf(attrs: string): Record<string, string> {
	const m = /style\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs)
	const out: Record<string, string> = {}
	const s = m ? (m[2] ?? m[3] ?? '') : ''
	for (const decl of decodeEntities(s).split(';')) {
		const i = decl.indexOf(':')
		if (i > 0) out[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim()
	}
	return out
}

function attr(attrs: string, name: string): string | undefined {
	const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(attrs)
	return m ? decodeEntities(m[2] ?? m[3] ?? '') : undefined
}

type Mark = Partial<Run>

function marksFromStyle(st: Record<string, string>): Mark {
	const m: Mark = {}
	if (st['color']) m.color = st['color']
	if (st['font-size']) {
		const v = parseFloat(st['font-size'])
		if (Number.isFinite(v)) m.size = st['font-size'].endsWith('pt') ? (v * 4) / 3 : v
	}
	if (st['font-family']) m.font = st['font-family'].replace(/["']/g, '').split(',')[0].trim()
	if (st['background-color']) m.bg = st['background-color']
	if (st['font-weight'] && (st['font-weight'] === 'bold' || parseInt(st['font-weight']) >= 600)) m.bold = true
	if (st['font-style'] === 'italic') m.italic = true
	const td = st['text-decoration'] ?? st['text-decoration-line']
	if (td?.includes('underline')) m.underline = true
	if (td?.includes('line-through')) m.strike = true
	return m
}

/** Parse PPTist HTML into paragraphs. Text outside any block becomes its own paragraph. */
export function parseHtml(html: string): Para[] {
	const paras: Para[] = []
	const stack: { tag: string; mark: Mark }[] = []
	const lists: { kind: 'bullet' | 'ordered'; id: number }[] = []
	let listCounter = 0
	let cur: Para | null = null
	let blockAlign: Para['align'] = 'left'
	const open = () => {
		if (!cur) {
			cur = { align: blockAlign, runs: [] }
			const l = lists[lists.length - 1]
			if (l) { cur.list = l.kind; cur.listId = l.id }
			paras.push(cur)
		}
		return cur
	}
	const close = () => { cur = null }
	const mark = (): Mark => Object.assign({}, ...stack.map((s) => s.mark))
	const re = /<(\/?)([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g
	let m: RegExpExecArray | null
	while ((m = re.exec(html || ''))) {
		if (m[4] !== undefined) {
			const text = decodeEntities(m[4]).replace(/[\r\n\t]+/g, ' ')
			if (!text) continue
			// whitespace between blocks (e.g. "</p>\n<p>") is not content
			if (!cur && !text.trim()) continue
			open().runs.push({ text, ...mark() })
			continue
		}
		const closing = m[1] === '/'
		const tag = m[2].toLowerCase()
		const attrs = m[3] || ''
		const block = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre']
		if (tag === 'br') {
			if (cur) close()
			else open()
			continue
		}
		if (tag === 'ul' || tag === 'ol') {
			if (closing) lists.pop()
			else lists.push({ kind: tag === 'ul' ? 'bullet' : 'ordered', id: ++listCounter })
			close()
			continue
		}
		if (block.includes(tag)) {
			if (closing) {
				// keep an explicitly empty paragraph (<p></p>) as a blank line
				if (tag !== 'li') { open(); close() }
				const i = stack.map((s) => s.tag).lastIndexOf(tag)
				if (i >= 0) stack.splice(i)
				continue
			}
			close()
			const st = styleOf(attrs)
			const ta = (st['text-align'] || attr(attrs, 'align') || '').toLowerCase()
			if (tag !== 'li') blockAlign = ta === 'center' || ta === 'right' || ta === 'justify' ? ta : 'left'
			const mk = marksFromStyle(st)
			if (/^h\d$/.test(tag)) mk.bold = true
			stack.push({ tag, mark: mk })
			if (tag === 'li') {
				// the item's own text opens lazily; nested <p> inside <li> re-closes
			}
			continue
		}
		if (closing) {
			const i = stack.map((s) => s.tag).lastIndexOf(tag)
			if (i >= 0) stack.splice(i)
			continue
		}
		if (/\/\s*$/.test(attrs)) continue // self-closing
		const st = styleOf(attrs)
		const mk = marksFromStyle(st)
		if (tag === 'strong' || tag === 'b') mk.bold = true
		if (tag === 'em' || tag === 'i') mk.italic = true
		if (tag === 'u') mk.underline = true
		if (tag === 's' || tag === 'strike' || tag === 'del') mk.strike = true
		if (tag === 'code') mk.code = true
		if (tag === 'a') mk.href = attr(attrs, 'href')
		stack.push({ tag, mark: mk })
	}
	// drop trailing empty paragraphs produced by closing tags of an empty doc
	while (paras.length > 1 && paras[paras.length - 1].runs.length === 0) paras.pop()
	return paras
}

export function plainText(paras: Para[]): string {
	return paras.map((p) => p.runs.map((r) => r.text).join('')).join('\n')
}

// ---------------------------------------------------------------- TipTap JSON

export interface RichText {
	type: string
	content: unknown[]
	attrs?: unknown
}

function textNode(r: Run) {
	const marks: { type: string; attrs?: Record<string, unknown> }[] = []
	if (r.bold) marks.push({ type: 'bold' })
	if (r.italic) marks.push({ type: 'italic' })
	if (r.underline) marks.push({ type: 'underline' })
	if (r.strike) marks.push({ type: 'strike' })
	if (r.code) marks.push({ type: 'code' })
	if (r.href) marks.push({ type: 'link', attrs: { href: r.href, target: '_blank', rel: 'noopener noreferrer nofollow', class: null } })
	return marks.length ? { type: 'text', text: r.text, marks } : { type: 'text', text: r.text }
}

function paragraphNode(p: Para) {
	// merge adjacent runs with the same marks; tiptap rejects empty text nodes
	const runs: Run[] = []
	for (const r of p.runs) {
		if (!r.text) continue
		const prev = runs[runs.length - 1]
		const key = (x: Run) => `${!!x.bold}${!!x.italic}${!!x.underline}${!!x.strike}${!!x.code}${x.href ?? ''}`
		if (prev && key(prev) === key(r)) prev.text += r.text
		else runs.push({ ...r })
	}
	return runs.length ? { type: 'paragraph', content: runs.map(textNode) } : { type: 'paragraph' }
}

/** Paragraphs → tldraw rich text (TipTap doc). Marks: bold, italic, underline, strike, code, link. */
export function toRichText(paras: Para[]): RichText {
	const content: unknown[] = []
	let i = 0
	while (i < paras.length) {
		const p = paras[i]
		if (p.list) {
			const items: unknown[] = []
			const id = p.listId
			while (i < paras.length && paras[i].list && paras[i].listId === id) {
				items.push({ type: 'listItem', content: [paragraphNode(paras[i])] })
				i++
			}
			content.push({ type: p.list === 'bullet' ? 'bulletList' : 'orderedList', ...(p.list === 'ordered' ? { attrs: { start: 1 } } : {}), content: items })
			continue
		}
		content.push(paragraphNode(p))
		i++
	}
	if (!content.length) content.push({ type: 'paragraph' })
	return { type: 'doc', content }
}

export function richTextFromPlain(text: string): RichText {
	return toRichText(text.split('\n').map((t) => ({ align: 'left', runs: t ? [{ text: t }] : [] })))
}
