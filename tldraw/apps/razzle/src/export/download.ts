// Browser download of an export.

/** A file name from a deck title: keeps letters, digits, spaces, dashes, dots. */
export function fileStem(title: string): string {
	const s = title.replace(/[^\p{L}\p{N} ._-]+/gu, ' ').replace(/\s+/g, ' ').trim()
	return s || 'deck'
}

export function downloadBlob(blob: Blob, name: string) {
	const url = URL.createObjectURL(blob)
	const a = document.createElement('a')
	a.href = url
	a.download = name
	a.style.display = 'none'
	document.body.appendChild(a)
	a.click()
	a.remove()
	setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
