// Speaker notes for exports: `meta.razzle.notes` (HTML) when present, else the script lines.
import type { RazzleSlideMeta } from '../model/types'

/** HTML → plain text, keeping paragraph and list structure as line breaks. */
export function htmlToText(html: string): string {
	const doc = new DOMParser().parseFromString(html, 'text/html')
	const out: string[] = []
	const walk = (n: Node) => {
		if (n.nodeType === Node.TEXT_NODE) {
			out.push((n.textContent ?? '').replace(/\s+/g, ' '))
			return
		}
		if (!(n instanceof Element)) return
		const tag = n.tagName.toLowerCase()
		if (tag === 'br') return void out.push('\n')
		const block = /^(p|div|li|h[1-6]|blockquote|pre|tr|ul|ol)$/.test(tag)
		if (block) out.push('\n')
		if (tag === 'li') out.push('• ')
		n.childNodes.forEach(walk)
		if (block) out.push('\n')
	}
	doc.body.childNodes.forEach(walk)
	return out
		.join('')
		.split('\n')
		.map((l) => l.trim())
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
}

function notesHtml(meta: RazzleSlideMeta): string | undefined {
	const n = (meta as { notes?: unknown }).notes
	return typeof n === 'string' && n.trim() ? n : undefined
}

/** Notes for the whole slide. */
export function slideNotes(meta: RazzleSlideMeta): string {
	const html = notesHtml(meta)
	if (html) return htmlToText(html)
	return (meta.script ?? []).map((s) => s.trim()).filter(Boolean).join('\n\n')
}

/** Notes for one build step: the step's script line when there is no notes HTML. */
export function stepNotes(meta: RazzleSlideMeta, step: number): string {
	const html = notesHtml(meta)
	if (html) return htmlToText(html)
	return (meta.script?.[step] ?? '').trim()
}
