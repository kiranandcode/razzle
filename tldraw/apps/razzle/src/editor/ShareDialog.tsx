import { useCallback, useEffect, useState } from 'react'
import { useDialogs, useEditor, useToasts, TldrawUiDialogHeader, TldrawUiDialogTitle, TldrawUiDialogCloseButton, TldrawUiDialogBody } from 'tldraw'
import { PUBLIC } from '../model/base'
import { listShares, publishShare, removeShare, type PublishedShare } from '../model/deck'
import type { DeckSync } from '../model/persist'
import { publishedShareUrl } from '../model/share'
import type { Deck } from '../model/types'
import { copyShareLink, shareDeck } from './sharing'

import { useStudio } from './context'
import { studioHooks } from './ui'

export function useSharePresentation() {
	const editor = useEditor()
	const { deck, sync } = useStudio()
	const { addDialog } = useDialogs()
	const { addToast } = useToasts()
	const [busy, setBusy] = useState(false)
	const share = useCallback(async () => {
		if (!PUBLIC) {
			addDialog({ id: 'share-presentation', component: () => <ShareDialog deck={deck} sync={sync} /> })
			return
		}
		setBusy(true)
		try { await shareDeck(editor, deck, sync?.$title.get() ?? deck.title, sync?.flush, addToast) }
		finally { setBusy(false) }
	}, [editor, deck, sync, addDialog, addToast])
	return { share, busy }
}

export function ShareActionBridge() {
	const { share } = useSharePresentation()
	useEffect(() => {
		studioHooks.share = share
		return () => { if (studioHooks.share === share) studioHooks.share = undefined }
	}, [share])
	return null
}

function ShareDialog({ deck, sync }: { deck: Deck; sync: DeckSync | null }) {
	const [shares, setShares] = useState<PublishedShare[]>([])
	const [busy, setBusy] = useState(true)
	const [message, setMessage] = useState('')
	useEffect(() => {
		let alive = true
		listShares(deck.id).then((items) => { if (alive) setShares(items) }, (e) => { if (alive) setMessage(String(e)) })
			.finally(() => { if (alive) setBusy(false) })
		return () => { alive = false }
	}, [deck.id])
	const run = async (action: () => Promise<void>) => {
		setBusy(true)
		setMessage('')
		try { await action() } catch (e) { setMessage(e instanceof Error ? e.message : String(e)) }
		finally { setBusy(false) }
	}
	const copy = async (id: string) => setMessage(await copyShareLink(publishedShareUrl(id)) ? 'Link copied.' : 'Select the link below to copy it.')
	return <>
		<TldrawUiDialogHeader><TldrawUiDialogTitle>Share presentation</TldrawUiDialogTitle><TldrawUiDialogCloseButton /></TldrawUiDialogHeader>
		<TldrawUiDialogBody>
			<div className="rz-share-dialog">
				<p>Anyone with the link can view the slides. No login or AI. Speaker notes and hidden slides are excluded.</p>
				<p>Saved changes appear at the same link. Viewers can refresh to see updates.</p>
				<button className="rz-btn" disabled={busy} onClick={() => void run(async () => {
					await sync?.flush()
					if (sync && sync.$status.get() !== 'saved') throw new Error('Wait until the deck is saved to the server before sharing.')
					const item = await publishShare(deck.id)
					setShares((items) => [item, ...items])
					await copy(item.id)
				})}>{busy ? 'Please wait…' : 'Create public link'}</button>
				<p role="status">{message}</p>
				{shares.map((item) => <div className="rz-share-item" key={item.id}>
					<label>{new Date(item.createdAt).toLocaleString()}
						<input aria-label="Public presentation link" readOnly value={publishedShareUrl(item.id)} onFocus={(e) => e.target.select()} />
					</label>
					<div className="rz-share-actions">
						<button className="rz-btn" disabled={busy} onClick={() => void run(() => copy(item.id))}>Copy</button>
						<a className="rz-btn" href={publishedShareUrl(item.id)} target="_blank" rel="noopener noreferrer">Preview</a>
						<button className="rz-btn" disabled={busy} onClick={() => void run(async () => {
							await removeShare(item.id)
							setShares((items) => items.filter((s) => s.id !== item.id))
							setMessage('Link removed. Existing copies are unaffected.')
						})}>Remove link</button>
					</div>
				</div>)}
			</div>
		</TldrawUiDialogBody>
	</>
}
