// The browser mic switch (speaker view and the studio top bar). Shown only when the server takes
// speech from the browser (state.mic.source === 'browser'); see ./mic.ts.
import { useRazzle } from '../model/client'
import './mic.css'
import { micToggle, useBrowserMic, useMic, type MicView } from './mic'

function label(v: MicView, elsewhere: boolean) {
	if (v.status === 'loading') return v.progress !== null ? `Loading ${Math.round(v.progress * 100)}%` : 'Starting…'
	if (v.status === 'listening') return 'Mic on'
	if (v.status === 'error') return 'Mic error'
	return elsewhere ? 'Mic elsewhere' : 'Mic off'
}

function title(v: MicView, elsewhere: boolean) {
	const parts: string[] = []
	if (v.status === 'off') parts.push(elsewhere ? 'Another screen is listening. Click to listen here instead.' : 'Listen with this browser’s microphone (transcribed in the browser).')
	if (v.status === 'loading') parts.push('Loading the speech model (once; it is cached afterwards).')
	if (v.status === 'listening') {
		parts.push(`Listening: ${v.model || 'Whisper'} on ${v.device === 'webgpu' ? 'the GPU (WebGPU)' : 'the CPU (WebAssembly)'}, in this browser. Click to stop.`)
		if (v.partialMs !== null) parts.push(`Last partial ${v.partialMs} ms, last pause ${v.pauseMs ?? '–'} ms.`)
	}
	if (v.message) parts.push(v.message)
	return parts.join('\n')
}

export function MicToggle({ variant }: { variant: 'speaker' | 'studio' }) {
	const shown = useBrowserMic()
	const v = useMic((x) => x)
	const active = useRazzle((s) => s.state.mic?.active ?? false)
	if (!shown) return null
	const elsewhere = active && v.status === 'off'
	const tip = title(v, elsewhere)
	return (
		<span className={`rz-mic rz-mic-${variant}`} data-status={v.status} data-elsewhere={elsewhere || undefined}>
			<button className="rz-mic-btn" onClick={() => void micToggle()} title={tip} aria-label={tip} aria-pressed={v.status === 'listening'}>
				<svg className="rz-mic-icon" viewBox="0 0 16 16" aria-hidden="true">
					<rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" />
					<path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2.5" />
					{v.status !== 'listening' && v.status !== 'loading' && <path className="rz-mic-slash" d="M2.5 2.5l11 11" />}
				</svg>
				<span className="rz-mic-label">{label(v, elsewhere)}</span>
				{v.status === 'listening' && (
					<span className="rz-mic-meter" aria-hidden="true">
						<span style={{ transform: `scaleX(${Math.max(0.04, v.level)})` }} />
					</span>
				)}
				{v.status === 'loading' && v.progress !== null && (
					<span className="rz-mic-meter rz-mic-progress" aria-hidden="true">
						<span style={{ transform: `scaleX(${v.progress})` }} />
					</span>
				)}
			</button>
			{v.message && (v.status === 'error' || variant === 'speaker') && <span className="rz-mic-msg">{v.message}</span>}
		</span>
	)
}
