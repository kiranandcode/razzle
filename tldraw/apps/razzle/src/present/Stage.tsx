// One slide at one build step, rendered by a read-only tldraw editor that holds
// the whole deck document (docs/DESIGN.md, "Studio": screens).
//
//  - Each stage owns its store: build opacities are written into it in memory
//    (remote changes: no history, nothing persisted), so the current and the
//    next stage can show different steps of the same document.
//  - Only the current frame is visible (`getShapeVisibility`); the camera is
//    fitted exactly to its page bounds and locked. Letterbox = the container.
//  - A reload (`version`) loads the new document into the same store; step and
//    slide changes never touch the snapshot, they only rewrite opacities.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Editor, TLShape, TLShapeId, Tldraw, atom, loadSnapshot, react } from 'tldraw'
import { buildOpacity, getSlides, slideShapes } from '../model/slides'
import type { Deck } from '../model/types'
import { makeStore, rememberOpacities, screenEditorProps } from './screenEditor'
import { ownBuild } from './slideInfo'

/** The offset tldraw adds to the HTML layer's translation at zoom `z` (utils/getHtmlLayerTransform.ts). */
function htmlLayerOffset(z: number) {
	const lerp = (v: number, [a, b]: [number, number], [c, d]: [number, number]) =>
		c + ((Math.min(Math.max(v, a), b) - a) / (b - a)) * (d - c)
	return z >= 1 ? lerp(z, [1, 8], [0.125, 0.5]) : lerp(z, [0.1, 1], [-2, 0.125])
}

/** Where the slide sits inside the stage, in CSS px (z = px per slide unit). */
export interface FitRect {
	left: number
	top: number
	width: number
	height: number
	z: number
}

export interface StageProps {
	deck: Deck
	version: number
	slideIndex: number
	step: number
	/** 'center' letterboxes evenly; 'start' pins the slide to the top-left. */
	align?: 'center' | 'start'
	className?: string
	onEditor?: (editor: Editor) => void
	/** Called after every (re)load of the document into this stage. */
	onLoaded?: (editor: Editor, version: number) => void
	onFit?: (fit: FitRect | null) => void
	children?: React.ReactNode
}

export function Stage({
	deck,
	version,
	slideIndex,
	step,
	align = 'center',
	className,
	onEditor,
	onLoaded,
	onFit,
	children,
}: StageProps) {
	const loadedVersion = useRef(0)
	const origOpacity = useRef(new Map<TLShapeId, number>())
	const [store] = useState(() => {
		const s = makeStore(deck)
		loadedVersion.current = version
		rememberOpacities(s.allRecords() as TLShape[], origOpacity.current)
		return s
	})
	const [editor, setEditor] = useState<Editor | null>(null)
	const $frame = useMemo(() => atom<TLShapeId | null>('present-frame', null), [])
	const $trim = useMemo(() => atom('present-trim', { z: 0, dx: 0, dy: 0 }), [])

	// Only the current frame (and what is inside it) is visible.
	const getShapeVisibility = useMemo(
		() => (shape: TLShape, ed: Editor) =>
			shape.parentId === ed.getCurrentPageId() && shape.id !== $frame.get() ? ('hidden' as const) : 'inherit',
		[$frame]
	)

	// Reload: the new document into the same store, then everything below re-applies.
	useLayoutEffect(() => {
		if (version === loadedVersion.current || !deck.document) return
		loadSnapshot(store, deck.document)
		loadedVersion.current = version
		origOpacity.current.clear()
		rememberOpacities(store.allRecords() as TLShape[], origOpacity.current)
	}, [store, deck, version])

	// Current frame + build opacities: synchronous, before paint.
	useLayoutEffect(() => {
		if (!editor) return
		const frame = getSlides(editor)[slideIndex]
		$frame.set(frame?.id ?? null)
		if (!frame) return
		const updates: TLShape[] = []
		for (const s of slideShapes(editor, frame)) {
			const want = (origOpacity.current.get(s.id) ?? s.opacity) * buildOpacity(ownBuild(s), step)
			if (Math.abs(s.opacity - want) > 1e-6) updates.push({ ...s, opacity: want })
		}
		if (updates.length) store.mergeRemoteChanges(() => store.put(updates))
	}, [editor, store, $frame, slideIndex, step, version])

	useEffect(() => {
		if (editor) onLoaded?.(editor, version)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [editor, version])

	// Camera: fitted exactly to the current frame, recomputed on resize.
	const lastFit = useRef('')
	useEffect(() => {
		if (!editor) return
		return react('present-fit', () => {
			const id = $frame.get()
			const vsb = editor.getViewportScreenBounds()
			const b = id ? editor.getShapePageBounds(id) : undefined
			if (!b || vsb.w <= 0 || vsb.h <= 0 || b.w <= 0 || b.h <= 0) {
				if (lastFit.current !== 'none') onFit?.(null)
				lastFit.current = 'none'
				return
			}
			const z = Math.min(vsb.w / b.w, vsb.h / b.h)
			// slide edges on whole pixels, so the letterbox meets the slide cleanly
			const left = align === 'center' ? Math.round((vsb.w - b.w * z) / 2) : 0
			const top = align === 'center' ? Math.round((vsb.h - b.h * z) / 2) : 0
			// tldraw nudges its HTML layer by a zoom-dependent offset (getHtmlLayerTransform);
			// cancel it so the slide's edges land exactly on those pixels
			const nudge = htmlLayerOffset(z)
			// ...and whatever sub-pixel residue remains, measured once per zoom
			const trim = $trim.get()
			const tx = trim.z === z ? trim.dx : 0
			const ty = trim.z === z ? trim.dy : 0
			editor.setCamera(
				{ x: -b.x + (left - tx) / z - nudge, y: -b.y + (top - ty) / z - nudge, z },
				{ force: true, immediate: true }
			)
			if (trim.z !== z && id) {
				const frameId = id
				requestAnimationFrame(() => {
					const el = editor.getContainer().querySelector(`[data-shape-id="${frameId}"]`)
					if (!el || editor.getZoomLevel() !== z) return
					const r = el.getBoundingClientRect()
					const c = editor.getViewportScreenBounds()
					$trim.set({ z, dx: r.x - c.x - left, dy: r.y - c.y - top })
				})
			}
			const fit = { left, top, width: b.w * z, height: b.h * z, z }
			const key = JSON.stringify(fit)
			if (key !== lastFit.current) {
				lastFit.current = key
				onFit?.(fit)
			}
		})
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [editor, $frame, $trim, align])

	return (
		<div className={`rz-stage ${className ?? ''}`}>
			<Tldraw
				{...screenEditorProps}
				store={store}
				getShapeVisibility={getShapeVisibility}
				onMount={(ed) => {
					ed.updateInstanceState({ isReadonly: true, isGridMode: false, isDebugMode: false })
					// camera locked: only the stage moves it (with `force`)
					ed.setCameraOptions({ isLocked: true })
					setEditor(ed)
					onEditor?.(ed)
				}}
			/>
			{children}
		</div>
	)
}

