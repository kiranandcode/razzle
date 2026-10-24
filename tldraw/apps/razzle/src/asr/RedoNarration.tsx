import { useState } from 'react'
import { redoNarration } from '../model/deck'

export function RedoNarration({ slideId }: { slideId?: string }) {
	const [busy, setBusy] = useState(false)
	const [message, setMessage] = useState('')
	return (
		<>
			<button
				className="rz-auto"
				disabled={busy || !slideId}
				title="Replace this slide’s narration with what you say next. Earlier takes stay saved."
				onClick={async () => {
					if (!slideId) return
					setBusy(true)
					try {
						await redoNarration(slideId)
						setMessage('Start this slide again. Notes update when you stop.')
					} catch (e) {
						setMessage(String(e))
					} finally {
						setBusy(false)
					}
				}}
			>
				Redo narration
			</button>
			{message && (
				<span role="status" onClick={() => setMessage('')}>
					{message}
				</span>
			)}
		</>
	)
}
