// Load check + renderer for converted decks / the tldraw library, driven by run.mjs over
// the DevTools protocol. Uses the studio's real shape utils, model and (when it exports
// one) theme; otherwise a stand-in theme with the Razzle palette and fonts.
//
//   ?deck=/@fs/<abs path to v2 deck json>       slides, one at a time (window.__show)
//   ?library=/@fs/<abs path to library.tldraw.json>  every item on one page
//   &utils=default                               tldraw's stock text/arrow/line utils
import { createRoot } from 'react-dom/client'
import {
	DEFAULT_THEME,
	Editor,
	TLShape,
	TLShapeId,
	TLTheme,
	Tldraw,
	createTLStore,
	defaultShapeUtils,
	loadSnapshot,
	type TLDefaultColor,
} from 'tldraw'
import 'tldraw/tldraw.css'
import { editorShapeUtils, shapeUtils } from '../../../../tldraw/apps/razzle/src/shapes/index.ts'
import * as studioTheme from '../../../../tldraw/apps/razzle/src/theme/index.ts'
import { buildOpacity, getSlides, slideShapes } from '../../../../tldraw/apps/razzle/src/model/slides.ts'
import { PALETTE } from '../../palette.ts'
import { TL_SCHEMA } from '../../schema.ts'

const q = new URLSearchParams(location.search)
const W = window as any
W.__errors = [] as string[]
const origError = console.error
console.error = (...a: unknown[]) => {
	W.__errors.push(a.map(String).join(' ').slice(0, 500))
	origError(...a)
}
window.addEventListener('error', (e) => W.__errors.push(String(e.message)))

declare const __RAZZLE_FONTS__: string
const fontsUrl = __RAZZLE_FONTS__

function color(hex: string): TLDefaultColor {
	return {
		solid: hex, semi: hex, pattern: hex, fill: hex, linedFill: hex,
		frameHeadingStroke: hex, frameHeadingFill: '#ffffff', frameStroke: hex, frameFill: '#ffffff', frameText: hex,
		noteFill: hex, noteText: '#000000', highlightSrgb: hex, highlightP3: hex,
	}
}
const face = (family: string, file: string, weight: string, style = 'normal') => ({ family, src: { url: fontsUrl + file, format: 'woff2' }, weight, style })

/** Stand-in for the studio theme (src/theme) until it exports one. */
function fallbackTheme(): TLTheme {
	const colors = Object.fromEntries(Object.entries(PALETTE).map(([k, v]) => [k, color(v)]))
	return {
		...DEFAULT_THEME,
		fonts: {
			...DEFAULT_THEME.fonts,
			serif: {
				fontFamily: "'Libre Baskerville', serif",
				faces: [
					face('Libre Baskerville', 'LibreBaskerville-Regular.woff2', 'normal'),
					face('Libre Baskerville', 'LibreBaskerville-Bold.woff2', 'bold'),
					face('Libre Baskerville', 'LibreBaskerville-Italic.woff2', 'normal', 'italic'),
					face('Libre Baskerville', 'LibreBaskerville-BoldItalic.woff2', 'bold', 'italic'),
				],
			},
			mono: {
				fontFamily: "'Roboto Mono', monospace",
				faces: [face('Roboto Mono', 'RobotoMono-Regular.woff2', 'normal'), face('Roboto Mono', 'RobotoMono-Bold.woff2', 'bold')],
			},
			sans: {
				fontFamily: "'Inter', sans-serif",
				faces: [face('Inter', 'Inter-Regular.woff2', 'normal'), face('Inter', 'Inter-SemiBold.woff2', 'bold')],
			},
		} as any,
		colors: {
			light: { ...DEFAULT_THEME.colors.light, ...colors } as any,
			dark: { ...DEFAULT_THEME.colors.dark, ...colors } as any,
		},
	}
}

const st = studioTheme as Record<string, any>
const themes = st.razzleThemes ?? { default: fallbackTheme() }
W.__themeSource = st.razzleThemes ? 'studio' : 'fallback'
const themeProps = st.tldrawThemeProps ?? { themes }

async function main() {
	const deckUrl = q.get('deck'), libUrl = q.get('library')
	const store = createTLStore({ shapeUtils: [...defaultShapeUtils, ...shapeUtils], themes })
	let deck: any = null
	try {
		if (deckUrl) {
			deck = await (await fetch(deckUrl)).json()
			loadSnapshot(store, deck.document)
		} else if (libUrl) {
			const lib = await (await fetch(libUrl)).json()
			loadSnapshot(store, libraryDocument(lib))
		}
	} catch (e) {
		W.__errors.push('load: ' + (e as Error).message)
	}
	const orig = new Map<TLShapeId, number>()
	for (const r of store.allRecords() as TLShape[]) if ((r as any).typeName === 'shape') orig.set(r.id, r.opacity)
	let current: TLShapeId | null = null

	const onMount = (editor: Editor) => {
		editor.updateInstanceState({ isReadonly: true, isGridMode: false })
		W.__editor = editor
		W.__slides = () => getSlides(editor).map((f) => ({ id: f.id, name: f.props.name }))
		W.__show = async (i: number, step: number) => {
			const frame = getSlides(editor)[i]
			if (!frame) throw new Error(`no slide ${i}`)
			current = frame.id
			const updates: TLShape[] = []
			for (const s of slideShapes(editor, frame)) {
				const b = (s.meta as any)?.build
				const own = b && Number.isInteger(b.step) && b.step >= 1 ? b : undefined
				const want = (orig.get(s.id) ?? 1) * buildOpacity(own, step)
				if (Math.abs(s.opacity - want) > 1e-6) updates.push({ ...s, opacity: want })
			}
			store.mergeRemoteChanges(() => store.put(updates))
			const b = editor.getShapePageBounds(frame.id)!
			const vsb = editor.getViewportScreenBounds()
			editor.setCamera({ x: -b.x, y: -b.y, z: vsb.w / b.w }, { force: true, immediate: true })
			editor.selectNone()
			await document.fonts.ready
			await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
			return { w: b.w, h: b.h }
		}
		W.__fitAll = async () => {
			current = null
			editor.zoomToFit({ animation: { duration: 0 } })
			await document.fonts.ready
			await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
		}
		W.__svg = async (i: number) => {
			const frame = getSlides(editor)[i]
			return editor.toImageDataUrl([frame.id], { format: 'png', padding: 0, background: true, pixelRatio: 1 })
		}
		W.__ready = true
	}

	createRoot(document.getElementById('root')!).render(
		<Tldraw
			store={store}
			{...themeProps}
			shapeUtils={q.get('utils') === 'default' ? shapeUtils : editorShapeUtils}
			hideUi
			autoFocus={false}
			components={{ Background: null, Grid: null }}
			getShapeVisibility={(shape: TLShape, editor: Editor) =>
				current && shape.parentId === editor.getCurrentPageId() && shape.id !== current ? 'hidden' : 'inherit'
			}
			onMount={onMount}
		/>
	)
}

/** Library items laid out on one page, each in a frame named after it. */
function libraryDocument(items: any[]) {
	const store: Record<string, any> = {
		'document:document': { id: 'document:document', typeName: 'document', gridSize: 10, name: '', meta: {} },
		'page:page': { id: 'page:page', typeName: 'page', name: 'Page 1', index: 'a1', meta: {} },
	}
	let x = 0, y = 0, rowH = 0
	const DIG = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
	const key = (n: number) => (n < 62 ? 'a' + DIG[n] : 'b' + DIG[Math.floor(n / 62)] + DIG[n % 62])
	items.forEach((it, n) => {
		const w = Math.max(it.width + 40, 160), h = it.height + 40
		if (x + w > 1800) { x = 0; y += rowH + 60; rowH = 0 }
		const fid = `shape:item-${n}`
		store[fid] = { id: fid, typeName: 'shape', type: 'frame', parentId: 'page:page', index: key(n + 1), x, y, rotation: 0, isLocked: false, opacity: 1, props: { w, h, name: it.id, color: 'black' }, meta: {} }
		const ids = new Map<string, string>()
		for (const s of it.shapes) ids.set(s.id, `shape:i${n}-${s.id.slice(6)}`)
		for (const a of it.assets ?? []) store[a.id] = a
		for (const s of it.shapes) {
			const parent = ids.get(s.parentId) ?? fid
			const top = parent === fid
			store[ids.get(s.id)!] = { typeName: 'shape', ...s, id: ids.get(s.id), parentId: parent, x: top ? s.x + 20 : s.x, y: top ? s.y + 20 : s.y }
		}
		x += w + 30
		rowH = Math.max(rowH, h)
	})
	return { store, schema: TL_SCHEMA as any }
}

main()
