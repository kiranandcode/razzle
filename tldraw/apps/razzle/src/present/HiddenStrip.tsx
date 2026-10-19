// Hidden slides strip of the speaker view: a thumbnail per hidden slide,
// exported by a private off-screen editor (all frames visible, no build
// opacities), the newest outlined, click to jump.
import { useEffect, useState } from 'react'
import { Editor, Tldraw, loadSnapshot } from 'tldraw'
import { nav } from '../model/client'
import type { Deck } from '../model/types'
import type { SlideInfo } from './slideInfo'
import { makeStore, screenEditorProps } from './screenEditor'

function useThumbnails(editor: Editor | null, version: number, hidden: SlideInfo[]) {
	const [urls, setUrls] = useState<Record<string, string>>({})
	const ids = hidden.map((s) => s.id).join(',')

	useEffect(() => {
		if (!editor || !ids) return
		let alive = true
		const made: string[] = []
		;(async () => {
			const next: Record<string, string> = {}
			// text exports blank until the faces it uses are loaded
			await editor.fonts.loadRequiredFontsForCurrentPage().catch(() => {})
			if (!alive) return
			for (const s of hidden) {
				try {
					const { blob } = await editor.toImage([s.id], {
						format: 'png',
						scale: 0.25,
						pixelRatio: 2,
						background: true,
						padding: 0,
					})
					const url = URL.createObjectURL(blob)
					made.push(url)
					next[s.id] = url
				} catch {
					/* leave the placeholder */
				}
				if (!alive) return
			}
			if (alive) setUrls(next)
		})()
		return () => {
			alive = false
			// revoke after the next set has replaced these in the DOM
			setTimeout(() => made.forEach((u) => URL.revokeObjectURL(u)), 5000)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [editor, version, ids])

	return urls
}

export function HiddenStrip({
	deck,
	version,
	hidden,
	newest,
	current,
}: {
	deck: Deck
	version: number
	hidden: SlideInfo[]
	newest: number
	current: number
}) {
	const [store] = useState(() => makeStore(deck))
	const [editor, setEditor] = useState<Editor | null>(null)
	const [loaded, setLoaded] = useState(version)
	useEffect(() => {
		if (version === loaded || !deck.document) return
		loadSnapshot(store, deck.document)
		setLoaded(version)
	}, [store, deck, version, loaded])

	const urls = useThumbnails(editor, loaded, hidden)

	return (
		<>
			<div className="rz-exporter" aria-hidden="true">
				<Tldraw
					{...screenEditorProps}
					store={store}
					onMount={(ed) => {
						ed.updateInstanceState({ isReadonly: true })
						if (import.meta.env.DEV) (window as any).__razzleExporter = ed
						setEditor(ed)
					}}
				/>
			</div>
			{hidden.length ? (
				<div className="rz-strip">
					{hidden.map((s) => (
						<button
							key={s.id}
							className={`rz-thumb${s.index === newest ? ' rz-newest' : ''}${s.index === current ? ' rz-thumb-current' : ''}`}
							onClick={() => nav('goto', { slide: s.index, step: 0 })}
							title={s.meta.generated?.prompt || s.title || `Slide ${s.index + 1}`}
						>
							{urls[s.id] ? <img src={urls[s.id]} alt="" draggable={false} /> : <span className="rz-thumb-blank">{s.title}</span>}
							<span className="rz-num">{s.index + 1}</span>
						</button>
					))}
				</div>
			) : (
				<div className="rz-none">None yet.</div>
			)}
		</>
	)
}
