// Audience screen: the slide, full-bleed, nothing else. The orb shows in the
// corner only when no speaker screen is connected; `black` blanks the screen.
import { useEffect, useRef, useState } from 'react'
import type { Editor } from 'tldraw'
import { nav, setBlack, useRazzle } from '../model/client'
import type { Deck } from '../model/types'
import { Highlights } from './Highlight'
import { Orb } from './Orb'
import { firstPos, lastPos, type SlideInfo } from './slideInfo'
import { Stage, type FitRect } from './Stage'
import { clickNav, useKeys } from './useKeys'

export function Audience({
	deck,
	version,
	slides,
	onLoaded,
}: {
	deck: Deck | null
	version: number
	slides: SlideInfo[]
	onLoaded: (editor: Editor) => void
}) {
	const state = useRazzle((s) => s.state)
	const [editor, setEditor] = useState<Editor | null>(null)
	const [fit, setFit] = useState<FitRect | null>(null)

	const goto = (p: { slide: number; step: number } | null) => p && nav('goto', { slide: p.slide, step: p.step })
	useKeys({
		first: () => goto(firstPos(slides)),
		last: () => goto(lastPos(slides)),
		toggleBlack: () => setBlack(!state.black),
	})

	// The cursor disappears after 2 s without movement.
	const [cursorHidden, setCursorHidden] = useState(true)
	const cursorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const wake = () => {
		setCursorHidden(false)
		if (cursorTimer.current) clearTimeout(cursorTimer.current)
		cursorTimer.current = setTimeout(() => setCursorHidden(true), 2000)
	}
	useEffect(() => () => void (cursorTimer.current && clearTimeout(cursorTimer.current)), [])

	return (
		<div className={`rz-audience${cursorHidden ? ' rz-no-cursor' : ''}`} onMouseMove={wake} {...clickNav()}>
			{deck && (
				<Stage
					deck={deck}
					version={version}
					slideIndex={state.slideIndex}
					step={state.step}
					onEditor={setEditor}
					onLoaded={(ed) => onLoaded(ed)}
					onFit={setFit}
				>
					<Highlights editor={editor} slideIndex={state.slideIndex} fit={fit} slideW={deck.width || 1000} />
				</Stage>
			)}
			{state.black && <div className="rz-black" />}
			{state.screens.speaker === 0 && (
				<div className="rz-orb-corner">
					<Orb status={state.agent} message={state.agentMessage} />
				</div>
			)}
		</div>
	)
}
