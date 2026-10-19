// The deck list shown when no deck is open: open one, or start a new one.
import { useEffect, useState } from 'react'
import { DeckSummary, listDecks } from '../model/deck'
import { listLocalDecks } from '../model/persist'
import { newDeckId } from './Studio'
import './studio.css'

export function DeckPicker({ onOpen }: { onOpen(id: string): void }) {
	const [decks, setDecks] = useState<DeckSummary[] | null>(null)
	const [offline, setOffline] = useState(false)
	const [title, setTitle] = useState('')

	useEffect(() => {
		document.title = 'Razzle'
		listDecks().then(
			(d) => setDecks(d),
			() => {
				setOffline(true)
				setDecks(listLocalDecks())
			}
		)
	}, [])

	const create = () => {
		const t = title.trim() || 'Untitled talk'
		onOpen(newDeckId(t))
	}

	return (
		<div className="rz-picker">
			<header className="rz-picker-head">
				<div className="rz-wordmark">Razzle</div>
				{offline && <span className="rz-picker-offline">Server not reachable: showing decks kept in this browser</span>}
			</header>
			<main className="rz-picker-main">
				<form
					className="rz-picker-new"
					onSubmit={(e) => {
						e.preventDefault()
						create()
					}}
				>
					<input className="rz-input" placeholder="Title of a new talk" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
					<button className="rz-btn rz-btn-primary" type="submit">
						New deck
					</button>
				</form>
				<h2>Decks</h2>
				{decks === null && <p className="rz-muted">Loading…</p>}
				{decks?.length === 0 && <p className="rz-muted">No decks yet.</p>}
				<ul className="rz-picker-list">
					{decks?.map((d) => (
						<li key={d.id}>
							<button onClick={() => onOpen(d.id)}>
								<span className="rz-picker-title">{d.title || d.id}</span>
								<span className="rz-picker-meta">
									{d.slideCount} {d.slideCount === 1 ? 'slide' : 'slides'}
									{d.updatedAt ? ` · ${new Date(d.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
								</span>
							</button>
						</li>
					))}
				</ul>
			</main>
		</div>
	)
}
