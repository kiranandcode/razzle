// The studio: one deck in a tldraw editor, with the slides panel (left), the library drawer,
// and the Builds / Speech inspector (right) around the canvas.
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Editor, TLShapeId, Tldraw, loadSnapshot, useEditor, useToasts, useValue } from 'tldraw'
import { exportPdf, exportPptx, exportReveal } from '../export'
import { PUBLIC } from '../model/base'
import { connect } from '../model/client'
import { DeckSync, OpenedDeck, mergeLocalEdits, openDeck, readLocalDeck, startDeckSync } from '../model/persist'
import { getSlides } from '../model/slides'
import { DECK_FORMAT, Deck, SLIDE_H, SLIDE_W } from '../model/types'
import { editorShapeUtils } from '../shapes'
import { applyRazzleDefaults, tldrawThemeProps } from '../theme'
import { BuildsPanel } from './BuildsPanel'
import { StudioContext } from './context'
import { LIBRARY_DRAG_TYPE, LibraryPanel, libraryItem } from './LibraryPanel'
import { insertLibraryItem } from './library'
import { presentHere, presentWithApp } from './presenting'
import { shareDeck } from './sharing'
import { addSlide, currentSlide, zoomToSlide } from './slideOps'
import { SlidesPanel } from './SlidesPanel'
import { SpeechPanel } from './SpeechPanel'
import { $inspector, $libraryOpen } from './state'
import { studioComponents, studioHooks, studioOverrides } from './ui'
import './studio.css'

/** Geo labels without tldraw's white halo (slides are flat). */
const shapeUtils = editorShapeUtils
const options = { maxPages: 1 }

/** Decks made in the picker that have not reached the server yet: id → title. */
const fresh = new Map<string, string>()

export function newDeckId(title: string) {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 32)
	const id = `${slug || 'deck'}-${Math.random().toString(36).slice(2, 6)}`
	fresh.set(id, title)
	return id
}

type Opened = OpenedDeck | { kind: 'new'; deck: Deck }

export function Studio({ deckId, onOpenDecks }: { deckId: string; onOpenDecks(): void }) {
	const [opened, setOpened] = useState<Opened | null>(null)
	const [error, setError] = useState('')
	useEffect(() => {
		setOpened(null)
		setError('')
		// The public studio has no server: a deck this browser has not kept starts out new.
		const title = fresh.get(deckId) ?? (PUBLIC && !readLocalDeck(deckId) ? 'Untitled talk' : undefined)
		if (title !== undefined) {
			setOpened({ kind: 'new', deck: { id: deckId, title, format: DECK_FORMAT, width: SLIDE_W, height: SLIDE_H, document: null as any, slides: [] } })
			return
		}
		openDeck(deckId).then(setOpened, (e) => setError(e instanceof Error ? e.message : String(e)))
	}, [deckId])

	if (error) return <Message title="Could not open the deck" text={error} onBack={onOpenDecks} />
	if (!opened) return <div className="rz-loading">Opening…</div>
	if (opened.kind === 'missing') return <Message title="No such deck" text={`There is no deck called “${deckId}”.`} onBack={onOpenDecks} />
	if (opened.kind === 'unsupported')
		return (
			<Message
				title="This deck is in the old format"
				text={`“${opened.deck.title}” is a PPTist deck. Convert it to the tldraw format (shared/tl) to edit it here.`}
				onBack={onOpenDecks}
			/>
		)
	return <StudioEditor key={deckId} opened={opened} onOpenDecks={onOpenDecks} />
}

function Message({ title, text, onBack }: { title: string; text: string; onBack(): void }) {
	return (
		<div className="rz-message">
			<h1>{title}</h1>
			<p>{text}</p>
			<button className="rz-btn" onClick={onBack}>
				All decks
			</button>
		</div>
	)
}

function StudioEditor({ opened, onOpenDecks }: { opened: Exclude<Opened, { kind: 'missing' } | { kind: 'unsupported' }>; onOpenDecks(): void }) {
	const deck = opened.deck
	const [left, setLeft] = useState<HTMLElement | null>(null)
	const [drawer, setDrawer] = useState<HTMLElement | null>(null)
	const [right, setRight] = useState<HTMLElement | null>(null)
	const [editor, setEditor] = useState<Editor | null>(null)
	const [sync, setSync] = useState<DeckSync | null>(null)
	const libraryOpen = useValue($libraryOpen)
	const inspector = useValue($inspector)

	const onMount = useCallback(
		(editor: Editor) => {
			let s: DeckSync
			if (opened.kind === 'new') {
				if (!getSlides(editor).length) addSlide(editor, { title: deck.title })
				s = startDeckSync(editor, deck, { startDirty: true })
				fresh.delete(deck.id)
			} else {
				loadSnapshot(editor.store, { document: deck.document })
				if (opened.kind === 'local') {
					s = startDeckSync(editor, deck, { base: opened.base, startDirty: true, offline: true })
				} else {
					s = startDeckSync(editor, deck, { base: deck.updatedAt })
					if (opened.localEdits) mergeLocalEdits(editor, opened.localEdits)
				}
			}
			editor.clearHistory()
			const undoDefaults = applyRazzleDefaults(editor)
			// the public build has no presenter app: it presents in this browser, from the edits just saved there
			const undoDblClick = presentOnOutsideDoubleClick(editor, (from) =>
				PUBLIC ? s.flush().then(() => presentHere(editor, deck.id, from)) : presentWithApp(editor, deck.id, from)
			)
			const first = getSlides(editor)[0]
			if (first) zoomToSlide(editor, first, false)
			connect('editor', deck.id)
			setEditor(editor)
			setSync(s)
			if (import.meta.env.DEV) (window as any).__razzleStudio = { editor, sync: s, hooks: studioHooks }
			return () => {
				undoDblClick()
				undoDefaults()
				s.dispose()
			}
		},
		[opened, deck]
	)

	// Main-menu actions that need the deck.
	useEffect(() => {
		if (!editor) return
		const current = (): Deck => ({ ...deck, title: sync?.$title.get() ?? deck.title })
		studioHooks.openDecks = async () => {
			await sync?.flush()
			onOpenDecks()
		}
		studioHooks.exportPptx = () => void exportPptx(editor, current())
		studioHooks.exportReveal = () => void exportReveal(editor, current())
		studioHooks.exportPdf = () => void exportPdf(editor, current())
		studioHooks.presentHere = async () => {
			await sync?.flush()
			presentHere(editor, deck.id)
		}
		studioHooks.share = () => void shareDeck(editor, deck, current().title, sync?.flush, (t) => toast?.(t))
	}, [editor, sync, deck, onOpenDecks])

	// PageUp / PageDown move between slides (arrows keep nudging shapes).
	useEffect(() => {
		if (!editor) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'PageDown' && e.key !== 'PageUp') return
			const t = e.target as HTMLElement | null
			if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
			if (editor.getEditingShapeId()) return
			const slides = getSlides(editor)
			if (!slides.length) return
			const i = slides.findIndex((s) => s.id === currentSlide(editor)?.id)
			const j = Math.max(0, Math.min(slides.length - 1, i + (e.key === 'PageDown' ? 1 : -1)))
			e.preventDefault()
			editor.selectNone()
			zoomToSlide(editor, slides[j], false)
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [editor])

	useEffect(() => {
		document.title = `${deck.title} · Razzle`
	}, [deck.title])

	// Opening or closing a side column resizes the canvas: keep a slide that was fully in view
	// fitted (a close-up stays as it was).
	useEffect(() => {
		if (!editor) return
		const slide = currentSlide(editor)
		const b = slide && editor.getShapePageBounds(slide.id)
		if (!slide || !b || !editor.getViewportPageBounds().contains(b)) return
		// Wait for tldraw to see the new canvas size, then fit.
		const before = editor.getViewportScreenBounds().w
		let frames = 0
		let raf = requestAnimationFrame(function tick() {
			if (editor.getViewportScreenBounds().w !== before || ++frames > 20) zoomToSlide(editor, slide, false)
			else raf = requestAnimationFrame(tick)
		})
		return () => cancelAnimationFrame(raf)
	}, [editor, libraryOpen, inspector])

	const onDragOver = (e: React.DragEvent) => {
		if (!e.dataTransfer.types.includes(LIBRARY_DRAG_TYPE)) return
		e.preventDefault()
		e.stopPropagation()
		e.dataTransfer.dropEffect = 'copy'
	}
	const onDrop = (e: React.DragEvent) => {
		const id = e.dataTransfer.getData(LIBRARY_DRAG_TYPE)
		if (!id || !editor) return
		e.preventDefault()
		e.stopPropagation()
		const item = libraryItem(id)
		if (!item) return
		insertLibraryItem(editor, item, editor.screenToPage({ x: e.clientX, y: e.clientY }))
		editor.focus()
	}

	return (
		<StudioContext.Provider value={{ deck, sync, openDecks: onOpenDecks }}>
			<div className="rz-studio tl-theme__light" data-library={libraryOpen} data-inspector={!!inspector}>
				<aside className="rz-left" ref={setLeft} />
				<aside className="rz-drawer" ref={setDrawer} />
				<main className="rz-canvas" onDragOverCapture={onDragOver} onDropCapture={onDrop}>
					<Tldraw
						{...tldrawThemeProps}
						shapeUtils={shapeUtils}
						components={studioComponents}
						overrides={studioOverrides}
						options={options}
						onMount={onMount}
					>
						<Panels left={left} drawer={drawer} right={right} />
					</Tldraw>
				</main>
				<aside className="rz-right" ref={setRight} />
			</div>
		</StudioContext.Provider>
	)
}

/** Rendered inside tldraw (for its editor and UI context) and portalled into the side columns. */
function Panels({ left, drawer, right }: { left?: HTMLElement | null; drawer?: HTMLElement | null; right?: HTMLElement | null }) {
	const libraryOpen = useValue($libraryOpen)
	const inspector = useValue($inspector)
	const editor = useEditor()
	const ready = useValue('has editor', () => !!editor, [editor])
	if (!ready) return null
	return (
		<>
			<Notifier />
			{left && createPortal(<SlidesPanel />, left)}
			{drawer && libraryOpen && createPortal(<LibraryPanel />, drawer)}
			{right &&
				inspector &&
				createPortal(
					<div className="rz-inspector">
						<div className="rz-tabs" role="tablist">
							<button role="tab" data-active={inspector === 'builds'} onClick={() => $inspector.set('builds')}>
								Builds
							</button>
							<button role="tab" data-active={inspector === 'speech'} onClick={() => $inspector.set('speech')}>
								Speech
							</button>
							<button className="rz-tabs-close" title="Close" onClick={() => $inspector.set(null)}>
								×
							</button>
						</div>
						{inspector === 'builds' ? <BuildsPanel /> : <SpeechPanel />}
					</div>,
					right
				)}
		</>
	)
}

let notify: ((title: string, description?: string) => void) | null = null
let toast: ReturnType<typeof useToasts>['addToast'] | null = null
function Notifier() {
	const toasts = useToasts()
	useEffect(() => {
		notify = (title, description) => toasts.addToast({ title, description, severity: 'error' })
		toast = toasts.addToast
		return () => {
			notify = null
			toast = null
		}
	}, [toasts])
	return null
}

/**
 * Double-click on empty canvas outside every slide presents from the slide nearest the middle
 * of the view (the Cove: double-click the board critter). Inside slides tldraw behaves as usual.
 */
function presentOnOutsideDoubleClick(editor: Editor, present: (from: 'nearest') => Promise<void>) {
	type Idle = { handleDoubleClickOnCanvas(info: unknown): void }
	const idle = editor.getStateDescendant('select.idle') as unknown as Idle | undefined
	if (!idle) return () => {}
	const original = idle.handleDoubleClickOnCanvas
	idle.handleDoubleClickOnCanvas = function (this: Idle, info: unknown) {
		const p = editor.inputs.getCurrentPagePoint()
		const inSlide = getSlides(editor).some((s) => editor.getShapePageBounds(s.id as TLShapeId)?.containsPoint(p))
		if (inSlide || !getSlides(editor).length) return original.call(this, info)
		present('nearest').catch((e) => notify?.('Could not present', e instanceof Error ? e.message : String(e)))
	}
	return () => {
		idle.handleDoubleClickOnCanvas = original
	}
}
