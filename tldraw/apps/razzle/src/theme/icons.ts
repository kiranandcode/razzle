// Razzle UI icons, drawn on tldraw's 30 × 30 icon grid (used as masks, so only alpha matters).
const svg = (body: string) =>
	`data:image/svg+xml;utf8,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
	)}`

export const RAZZLE_ICONS: Record<string, string> = {
	'rz-slide': svg('<rect x="4" y="8" width="22" height="14" rx="1.5"/><path d="M8 12.5h8"/>'),
	'rz-slide-add': svg('<rect x="3" y="6" width="19" height="12" rx="1.5"/><path d="M24 20v7M20.5 23.5h7"/>'),
	'rz-eye': svg('<path d="M3 15s4.5-8 12-8 12 8 12 8-4.5 8-12 8S3 15 3 15z"/><circle cx="15" cy="15" r="3.5"/>'),
	'rz-eye-off': svg(
		'<path d="M6.5 9.5C4.3 11.6 3 15 3 15s4.5 8 12 8c2.3 0 4.3-.7 6-1.8M12 7.4C13 7.1 14 7 15 7c7.5 0 12 8 12 8s-1 1.9-2.9 3.9"/><path d="M4 4l22 22"/><path d="M12.6 12.7a3.5 3.5 0 0 0 4.8 4.8"/>'
	),
	'rz-play': svg('<path d="M10 7.5v15l12-7.5z" fill="black"/>'),
	'rz-present': svg('<rect x="4" y="5" width="22" height="15" rx="1.5"/><path d="M15 20v5M10 25h10"/><path d="M13 9.5v6l5-3z" fill="black"/>'),
	'rz-record': svg('<circle cx="15" cy="15" r="7" fill="black" stroke="none"/>'),
	'rz-stop': svg('<rect x="9" y="9" width="12" height="12" rx="1.5" fill="black" stroke="none"/>'),
	'rz-library': svg('<rect x="4" y="5" width="9" height="9" rx="1"/><path d="M21.5 5l5 9h-10z"/><circle cx="8.5" cy="21" r="4.5"/><rect x="17" y="17" width="9" height="8" rx="1"/>'),
	'rz-builds': svg('<rect x="5" y="17" width="20" height="7" rx="1"/><rect x="8" y="9" width="14" height="6" rx="1" stroke-dasharray="2.5 2.5"/><path d="M15 3v3"/>'),
	'rz-speech': svg('<path d="M6 7h18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9l-6 5v-5H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/><path d="M9 12h12M9 15.5h8"/>'),
	'rz-notes': svg('<path d="M8 4h10l5 5v17H8z"/><path d="M18 4v5h5"/><path d="M11.5 14h8M11.5 18h8M11.5 22h5"/>'),
	'rz-step': svg('<path d="M5 24h6v-6h6v-6h6V6"/>'),
	'rz-grip': svg('<circle cx="11" cy="9" r="1.2" fill="black"/><circle cx="19" cy="9" r="1.2" fill="black"/><circle cx="11" cy="15" r="1.2" fill="black"/><circle cx="19" cy="15" r="1.2" fill="black"/><circle cx="11" cy="21" r="1.2" fill="black"/><circle cx="19" cy="21" r="1.2" fill="black"/>'),
	'rz-code': svg('<path d="M11 9l-6 6 6 6M19 9l6 6-6 6M17 6.5l-4 17"/>'),
	'rz-decks': svg('<rect x="4" y="9" width="17" height="12" rx="1.5"/><path d="M8 6h17.5a.5.5 0 0 1 .5.5V18"/>'),
}
