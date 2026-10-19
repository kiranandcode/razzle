// Dev-only harness for src/export: a tldraw editor with a fixed test deck, exposing the
// exporters on `window.__razzleExportTest`. Open /src/export/__dev__/index.html under `npx vite`.
import ReactDOM from 'react-dom/client'
import { Editor, Tldraw, TLShapeId, createShapeId, getSnapshot, toRichText } from 'tldraw'
import 'tldraw/tldraw.css'
import { buildSlideIndex } from '../../model/slides'
import { DECK_FORMAT, Deck, SLIDE_H, SLIDE_W } from '../../model/types'
import { editorShapeUtils as shapeUtils } from '../../shapes'
import { applyRazzleDefaults, tldrawThemeProps } from '../../theme'
import { buildPptx, buildPrintHtml, buildRevealHtml, exportPdf, exportPptx, exportReveal } from '../index'
import { buildTestDeck } from './testDeck'

function deckOf(editor: Editor): Deck {
	return {
		id: 'export-test',
		title: 'Export test: builds & shapes',
		format: DECK_FORMAT,
		width: SLIDE_W,
		height: SLIDE_H,
		document: getSnapshot(editor.store).document,
		slides: buildSlideIndex(editor),
	}
}

const blobToB64 = (b: Blob) =>
	new Promise<string>((res) => {
		const r = new FileReader()
		r.onload = () => res((r.result as string).split(',')[1])
		r.readAsDataURL(b)
	})

function onMount(editor: Editor) {
	applyRazzleDefaults(editor)
	buildTestDeck(editor)
	const deck = () => deckOf(editor)
	;(window as any).__razzleExportTest = {
		editor,
		deck,
		createShapeId,
		toRichText,
		exportPptx: (o?: any) => exportPptx(editor, deck(), o),
		exportReveal: (o?: any) => exportReveal(editor, deck(), o),
		exportPdf: (o?: any) => exportPdf(editor, deck(), o),
		/** Base64 PPTX + report, for harnesses that can't catch downloads. */
		pptxB64: async (o?: any) => {
			const { blob, report } = await buildPptx(editor, deck(), o)
			return { b64: await blobToB64(blob), report }
		},
		revealHtml: (o?: any) => buildRevealHtml(editor, deck(), o),
		printHtml: (o?: any) => buildPrintHtml(editor, deck(), o),
		docJson: () => JSON.stringify(editor.store.getStoreSnapshot('document').store),
		ready: true,
	}
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
	<div style={{ position: 'fixed', inset: 0 }}>
		<Tldraw shapeUtils={shapeUtils} {...tldrawThemeProps} onMount={onMount} />
	</div>
)

export type { TLShapeId }
