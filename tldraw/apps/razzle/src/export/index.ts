// Deck export (docs/DESIGN.md, "Studio (tldraw)"): PPTX for Google Slides / PowerPoint,
// a self-contained reveal.js page, and PDF through the print dialog. Every exporter works
// on a throwaway copy of the document, so build opacities never reach the user's deck.
import { exportPdf } from './pdf'
import { exportPptx } from './pptx'
import { exportReveal } from './reveal'

export { buildPrintHtml, exportPdf, type PdfExportOptions } from './pdf'
export { buildPptx, exportPptx, type PptxExportOptions, type PptxExportReport } from './pptx'
export { buildRevealHtml, exportReveal, type RevealExportOptions } from './reveal'

// Dev builds: drive the exporters from the console or a test harness.
if (import.meta.env.DEV && typeof window !== 'undefined') {
	;(window as any).__razzleExport = { exportPptx, exportReveal, exportPdf }
}
