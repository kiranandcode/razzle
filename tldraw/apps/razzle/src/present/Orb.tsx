// The agent orb (docs/DESIGN.md, "Screens"): a ~10 px softly glowing dot whose
// colour and pulse follow AgentStatus. Visible if you look for it, not otherwise.
import type { AgentStatus } from '../model/client'

export function Orb({ status, message = '', size = 10 }: { status: AgentStatus; message?: string; size?: number }) {
	return (
		<span
			className={`rz-orb rz-orb-${status}`}
			// remount on status change so one-shot animations (acting) replay
			key={status}
			style={{ width: size, height: size }}
			title={message ? `${status} · ${message}` : status}
			role="status"
			aria-label={`Agent ${status}${message ? ': ' + message : ''}`}
		/>
	)
}
