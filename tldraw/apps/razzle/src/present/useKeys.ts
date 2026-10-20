// Keyboard and clicker input for the screens. Every navigation key sends a
// `nav` with source 'human'; the server decides (and debounces). Screens never
// move on their own.
//
//   → ↓ Space PageDown Enter   next          ← ↑ PageUp Backspace   previous
//   Home / End                 first / last  <number> Enter         go to slide <number>
//   b  .                       black screen
// Speaker only (passed as `extra`): g h a ?
import { useEffect, useRef, useState } from 'react'
import { nav } from '../model/client'

export interface KeyActions {
	first: () => void
	last: () => void
	toggleBlack: () => void
	escape?: () => void
	/** Extra single-character keys (lower case), e.g. { g: jumpHidden }. */
	extra?: Record<string, () => void>
}

const NEXT = new Set(['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'])
const PREV = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'])

/** Returns the digits typed so far for "<number> Enter" (the speaker view shows them). */
export function useKeys(actions: KeyActions): string {
	const [typed, setTypedState] = useState('')
	const typedRef = useRef('')
	const actionsRef = useRef(actions)
	actionsRef.current = actions

	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | null = null
		const setTyped = (s: string) => {
			typedRef.current = s
			setTypedState(s)
			if (timer) clearTimeout(timer)
			if (s) timer = setTimeout(() => setTyped(''), 2500)
		}

		const onKey = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey) return
			const t = e.target as HTMLElement | null
			if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
			const a = actionsRef.current
			const typed = typedRef.current

			if (e.repeat) {
				// a held key never repeats a navigation or a toggle
				e.preventDefault()
				return
			}
			if (/^[0-9]$/.test(e.key)) {
				setTyped((typed + e.key).slice(-4))
			} else if (e.key === 'Enter' && typed) {
				const n = parseInt(typed, 10)
				setTyped('')
				if (n >= 1) nav('goto', { slide: n - 1, step: 0 })
			} else if (e.key === 'Backspace' && typed) {
				setTyped(typed.slice(0, -1))
			} else if (e.key === 'Escape') {
				setTyped('')
				a.escape?.()
				return
			} else if (NEXT.has(e.key)) nav('next')
			else if (PREV.has(e.key)) nav('prev')
			else if (e.key === 'Home') a.first()
			else if (e.key === 'End') a.last()
			else if (e.key === 'b' || e.key === 'B' || e.key === '.') a.toggleBlack()
			else {
				const fn = a.extra?.[e.key.toLowerCase()] ?? a.extra?.[e.key]
				if (!fn) return
				fn()
			}
			e.preventDefault()
			e.stopPropagation()
		}

		// capture: before anything inside the page (tldraw) sees the key
		window.addEventListener('keydown', onKey, true)
		return () => {
			window.removeEventListener('keydown', onKey, true)
			if (timer) clearTimeout(timer)
		}
	}, [])

	return typed
}

/**
 * Mouse on the slide: left click = next; right click or shift-click = previous
 * (the context menu is suppressed there). Clicks that end a text selection or
 * land on a control are ignored.
 */
export function clickNav() {
	const ignore = (e: React.MouseEvent) => {
		const sel = window.getSelection()
		if (sel && !sel.isCollapsed && sel.toString().trim()) return true
		return !!(e.target as HTMLElement).closest('button, a, input, textarea, select, [contenteditable="true"]')
	}
	return {
		onClick: (e: React.MouseEvent) => {
			if (e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || ignore(e)) return
			e.preventDefault()
			nav(e.shiftKey ? 'prev' : 'next')
		},
		onContextMenu: (e: React.MouseEvent) => {
			e.preventDefault()
			// one right-click can raise two contextmenu events (press and release on some systems)
			if (ignore(e) || e.timeStamp - lastContextMenu < 300) return
			lastContextMenu = e.timeStamp
			nav('prev')
		},
	}
}

let lastContextMenu = -Infinity
