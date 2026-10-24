import type { MicView } from './mic'

export function transcriptStatus(view: MicView, context: { connected: boolean; active: boolean; browser: boolean; micActive: boolean }) {
	if (!context.connected) return 'Reconnecting… Transcription is waiting for the server.'
	if (!context.active) return 'Start presenting to transcribe your talk.'
	if (!context.browser) return context.micActive ? 'Listening. Pause briefly to finish a sentence.' : 'The server microphone is off.'
	if (view.status === 'error') return `${view.message || 'Transcription failed.'} Click the microphone to retry.`
	if (view.status === 'waiting') return 'Audio is paused. Click Start audio above to begin listening.'
	if (view.status === 'loading') return `Preparing transcription${view.progress === null ? '…' : ` (${Math.round(view.progress * 100)}%)…`} ${view.message || 'Allow microphone access if prompted.'}`
	if (view.status === 'off') return context.micActive ? 'The microphone is on in another window. Waiting for its transcript.' : 'Microphone off. Click the microphone above to start transcription.'
	if (view.message.startsWith('Transcription failed:')) return view.message
	return 'Listening. Pause briefly to finish a sentence.'
}
