// reveal.js export: one self-contained HTML page, one <section> per slide.
//
// Build steps are stacked full-slide SVGs: step 0 is the base, step k (k ≥ 1) is a
// fragment with index k-1 on top of it. Each step SVG is the whole slide on an opaque
// background, so the topmost visible fragment is exactly the slide at that step, and the
// switch is instant (fragment transitions are disabled). Hidden slides are left out
// unless `includeHidden` (then they carry data-visibility="hidden": reachable by hash only).
import { Editor } from 'tldraw'
import type { Deck } from '../model/types'
import { downloadBlob, fileStem } from './download'
import { planSlides } from './exportEditor'
import { slideNotes } from './notes'
import { escapeHtml, fillBox, renderDeckSvgs } from './svg'

export interface RevealExportOptions {
	includeHidden?: boolean
	/** 'expand' (default): every build step is a fragment. 'final': the finished slide only. */
	builds?: 'expand' | 'final'
}

const REVEAL = 'https://cdn.jsdelivr.net/npm/reveal.js@5.2.1'

export async function buildRevealHtml(editor: Editor, deck: Deck, opts: RevealExportOptions = {}): Promise<string> {
	const plans = planSlides(editor, { builds: opts.builds ?? 'expand', includeHidden: opts.includeHidden })
	const { slides, fontCss, background } = await renderDeckSvgs(editor, plans)
	const W = deck.width || 1000
	const H = deck.height || 562.5

	const sections = slides
		.map(({ plan, steps }) => {
			const layers = steps
				.map(({ svg }, i) => {
					const cls = i === 0 ? 'rz-step' : 'rz-step fragment'
					const idx = i === 0 ? '' : ` data-fragment-index="${i - 1}"`
					return `<div class="${cls}"${idx}>${fillBox(svg, 'rz-svg')}</div>`
				})
				.join('\n')
			const notes = slideNotes(plan.meta)
			const aside = notes ? `\n<aside class="notes">${escapeHtml(notes).replace(/\n/g, '<br>')}</aside>` : ''
			const vis = plan.hidden ? ' data-visibility="hidden"' : ''
			return `<section data-razzle-slide="${escapeHtml(plan.frame.id)}" data-title="${escapeHtml(plan.title)}"${vis}>\n${layers}${aside}\n</section>`
		})
		.join('\n')

	const config = {
		transition: 'none',
		backgroundTransition: 'none',
		controls: false,
		progress: false,
		slideNumber: false,
		overview: false,
		navigationMode: 'linear',
		hash: true,
		center: false,
		width: W,
		height: H,
		margin: 0,
		plugins: ['__NOTES__'],
	}

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(deck.title)}</title>
<link rel="stylesheet" href="${REVEAL}/dist/reveal.css">
<style>
${fontCss}
html, body, .reveal-viewport { background: #000; }
.reveal .slides { text-align: left; }
.reveal .slides > section { padding: 0 !important; width: ${W}px; height: ${H}px; background: ${background}; }
.reveal .slides > section > .rz-step { position: absolute; inset: 0; }
.reveal .slides > section > .rz-step > svg { display: block; width: 100%; height: 100%; }
.reveal .slides section .fragment.rz-step { opacity: 0; visibility: hidden; transition: none !important; transform: none !important; }
.reveal .slides section .fragment.rz-step.visible { opacity: 1; visibility: inherit; }
</style>
</head>
<body>
<div class="reveal"><div class="slides">
${sections}
</div></div>
<script src="${REVEAL}/dist/reveal.js"></script>
<script src="${REVEAL}/plugin/notes/notes.js"></script>
<script>
Reveal.initialize(${JSON.stringify(config).replace('"__NOTES__"', 'RevealNotes')});
// click to advance; right-click or shift-click to go back
document.addEventListener('click', (e) => { if (e.button === 0) e.shiftKey ? Reveal.prev() : Reveal.next() });
document.addEventListener('contextmenu', (e) => { e.preventDefault(); Reveal.prev() });
</script>
</body>
</html>
`
}

/** Download the deck as a reveal.js HTML page (`<title>.html`). */
export async function exportReveal(editor: Editor, deck: Deck, opts: RevealExportOptions = {}): Promise<void> {
	const html = await buildRevealHtml(editor, deck, opts)
	downloadBlob(new Blob([html], { type: 'text/html' }), `${fileStem(deck.title)}.html`)
}
