import { useEffect, useState } from 'react'
import { saveSpeakerNotes } from '../model/deck'
import { notesHtml, notesText } from '../model/noteText'

export function SpeakerNotes({ deckId, slideId, html }: { deckId: string; slideId: string; html: string }) {
	const key = `razzle-notes-draft:${deckId}:${slideId}`
	const [draft, setDraft] = useState<{ text: string; base: string } | null>(() => {
		try { return JSON.parse(sessionStorage.getItem(key) ?? 'null') } catch { return null }
	})
	const [busy, setBusy] = useState(false)
	const [message, setMessage] = useState('')
	const [savedHtml, setSavedHtml] = useState<string | null>(null)
	useEffect(() => setSavedHtml(null), [html])
	const edit = (text: string) => {
		const next = { text, base: draft?.base ?? savedHtml ?? html }
		setDraft(next)
		try { sessionStorage.setItem(key, JSON.stringify(next)) } catch { /* the field still keeps the draft */ }
		setMessage('Unsaved')
	}
	return <div className="rz-panel rz-notes">
		<div className="rz-label">Notes <span role="status">{message || (draft ? 'Unsaved draft' : '')}</span></div>
		<textarea className="rz-notes-edit" aria-label="Speaker notes" value={draft?.text ?? notesText(savedHtml ?? html)}
			onChange={(e) => edit(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="What you want to say on this slide" />
		<button className="rz-help-btn" disabled={!draft || busy} onClick={async () => {
			if (!draft) return
			const saving = draft
			setBusy(true)
			try {
				const saved = notesHtml(saving.text)
				await saveSpeakerNotes(deckId, slideId, saved, saving.base)
				setSavedHtml(saved)
				setDraft((current) => {
					if (current === saving) { sessionStorage.removeItem(key); return null }
					const next = current && { ...current, base: saved }
					if (next) sessionStorage.setItem(key, JSON.stringify(next))
					return next
				})
				setMessage('Saved')
			} catch (e) { setMessage(e instanceof Error ? e.message : String(e)) }
			finally { setBusy(false) }
		}}>{busy ? 'Saving…' : 'Save notes'}</button>
		{draft && draft.base !== html && <div role="status">Notes changed elsewhere. Your draft is kept.
			<button className="rz-help-btn" disabled={busy} onClick={() => {
				setDraft(null); setSavedHtml(null); setMessage(''); sessionStorage.removeItem(key)
			}}>Load current notes</button>
		</div>}
	</div>
}
