// PDF export through the browser's print path: a page per slide (or per build step),
// each the slide's vector SVG with fonts embedded. The user picks "Save as PDF" in the
// print dialog; the page size is the slide's 16:9 size (10in × 5.625in).
import { Editor } from 'tldraw'
import type { Deck } from '../model/types'
import { planSlides } from './exportEditor'
import { escapeHtml, fillBox, renderDeckSvgs } from './svg'

export interface PdfExportOptions {
	includeHidden?: boolean
	/** 'final' (default): one page per slide, the finished slide. 'expand': one page per build step. */
	builds?: 'expand' | 'final'
}

const PAGE_W_IN = 10

/** The printable HTML (also what the tests print headlessly with Page.printToPDF). */
export async function buildPrintHtml(editor: Editor, deck: Deck, opts: PdfExportOptions = {}): Promise<string> {
	const plans = planSlides(editor, { builds: opts.builds ?? 'final', includeHidden: opts.includeHidden })
	const { slides, fontCss, background } = await renderDeckSvgs(editor, plans)
	const W = deck.width || 1000
	const H = deck.height || 562.5
	const pageH = (PAGE_W_IN * H) / W
	const pages = slides
		.flatMap(({ steps }) => steps.map(({ svg }) => `<div class="page">${fillBox(svg, 'rz-svg')}</div>`))
		.join('\n')
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(deck.title)}</title>
<style>
${fontCss}
@page { size: ${PAGE_W_IN}in ${pageH}in; margin: 0; }
html, body { margin: 0; padding: 0; background: ${background}; }
.page { width: ${PAGE_W_IN}in; height: ${pageH}in; overflow: hidden; break-after: page; page-break-after: always; }
.page:last-child { break-after: auto; page-break-after: auto; }
.page > svg { display: block; width: 100%; height: 100%; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
</style>
</head>
<body>
${pages}
</body>
</html>
`
}

/** Open the print dialog on the deck (save as PDF from there). */
export async function exportPdf(editor: Editor, deck: Deck, opts: PdfExportOptions = {}): Promise<void> {
	const html = await buildPrintHtml(editor, deck, opts)
	const frame = document.createElement('iframe')
	Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
	frame.setAttribute('aria-hidden', 'true')
	document.body.appendChild(frame)
	const win = frame.contentWindow!
	win.document.open()
	win.document.write(html)
	win.document.close()
	win.document.title = deck.title // the default "Save as PDF" file name
	await win.document.fonts?.ready
	await new Promise((r) => setTimeout(r, 50))
	const cleanup = () => setTimeout(() => frame.remove(), 1000)
	win.addEventListener('afterprint', cleanup, { once: true })
	win.focus()
	win.print()
	// Some browsers return from print() before the dialog closes and never fire afterprint.
	setTimeout(() => frame.isConnected && frame.remove(), 60_000)
}
