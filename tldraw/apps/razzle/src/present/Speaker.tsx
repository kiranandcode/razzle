// Speaker screen: current slide at its step, what comes next, the script line
// for this step, notes, transcript, cues, timer, orb and the hidden slides.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from 'tldraw'
import { micStop, useAutoMic } from '../asr/mic'
import { MicToggle } from '../asr/MicToggle'
import { PUBLIC } from '../model/base'
import { nav, on, requestHidden, setBlack, setMode, useRazzle } from '../model/client'
import { movePosition } from '../model/slides'
import type { Deck } from '../model/types'
import { Highlights } from './Highlight'
import { HiddenStrip } from './HiddenStrip'
import { Orb } from './Orb'
import { firstPos, lastPos, type SlideInfo } from './slideInfo'
import { Stage, type FitRect } from './Stage'
import { clickNav, useKeys } from './useKeys'
import { SpeakerNotes } from './SpeakerNotes'

const pad = (n: number) => String(n).padStart(2, '0')
const MODE_LABEL = { idle: 'Idle', record: 'Recording', present: 'Presenting' } as const

/** Notes are authored HTML; keep the markup, drop anything active. */
function cleanHtml(html: string) {
	const doc = new DOMParser().parseFromString(html, 'text/html')
	doc.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((n) => n.remove())
	doc.body.querySelectorAll('*').forEach((el) => {
		for (const a of [...el.attributes]) {
			if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name)
		}
	})
	return doc.body.innerHTML
}

function useNow(ms: number) {
	const [now, setNow] = useState(Date.now())
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), ms)
		return () => clearInterval(t)
	}, [ms])
	return now
}

export function Speaker({
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
	const connected = useRazzle((s) => s.connected)
	const partial = useRazzle((s) => s.partial)
	const finals = useRazzle((s) => s.finals)
	const [editor, setEditor] = useState<Editor | null>(null)
	const [fit, setFit] = useState<FitRect | null>(null)
	const [helpOpen, setHelpOpen] = useState(false)
	const [stopping, setStopping] = useState(false)
	const notesStatus = useRazzle((s) => s.notesStatus?.deckId === deck?.id ? s.notesStatus : undefined)
	// browser mic (RAZZLE_AUDIO=browser): the speaker view listens while a talk is presented
	useAutoMic(state.mode !== 'idle', { claim: true })

	const slide = slides[state.slideIndex] as SlideInfo | undefined
	const stepCount = state.stepCount || slide?.stepCount || 1
	const walk = useMemo(
		() => slides.map((s, i) => ({ hidden: s.hidden, stepCount: i === state.slideIndex ? stepCount : s.stepCount })),
		[slides, state.slideIndex, stepCount]
	)
	const next = slide ? movePosition(walk, { slide: state.slideIndex, step: Math.min(state.step, stepCount - 1) }, 1) : null
	const nextLabel = !next ? 'Next' : next.slide === state.slideIndex ? `Next · step ${next.step + 1}` : `Next · slide ${next.slide + 1}`

	const scriptLine = slide?.meta.script?.[state.step]?.trim() ?? ''
	const nextScriptLine = next ? (slides[next.slide]?.meta.script?.[next.step]?.trim() ?? '') : ''
	const notes = useMemo(() => (slide?.meta.notes ? cleanHtml(slide.meta.notes) : ''), [slide])

	// Cues armed on this slide light once heard at this position, or when the server says one fired.
	const [fired, setFired] = useState<Set<string>>(new Set())
	useEffect(() => on('cue-fired', ({ id }) => setFired((f) => new Set(f).add(id))), [])
	// a cue's 'step' action moves the step, so fired cues stay lit until the slide changes
	useEffect(() => setFired((f) => (f.size ? new Set() : f)), [state.slideIndex])
	const heardHere = useMemo(() => {
		const words = finals.filter((u) => u.slideIndex === state.slideIndex && u.step === state.step).map((u) => u.text)
		words.push(partial)
		return ` ${words.join(' ').toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ')} `.replace(/\s+/g, ' ')
	}, [finals, partial, state.slideIndex, state.step])
	const cues = (slide?.meta.cues ?? []).map((c) => {
		const phrase = c.phrase.toLowerCase().trim().replace(/\s+/g, ' ')
		return {
			...c,
			armed: c.atStep === undefined || c.atStep === state.step,
			heard: fired.has(c.id) || (!!phrase && heardHere.includes(` ${phrase} `)),
		}
	})

	// Hidden slides. Newest = latest `generated.at`, else the one last announced, else the last.
	const hidden = useMemo(() => slides.filter((s) => s.hidden), [slides])
	const [announced, setAnnounced] = useState(-1)
	const newest = useMemo(() => {
		let best = -1
		let bestAt = 0
		for (const s of hidden) {
			const at = s.meta.generated?.at ?? 0
			if (at > bestAt) {
				best = s.index
				bestAt = at
			}
		}
		if (best >= 0) return best
		if (hidden.some((s) => s.index === announced)) return announced
		return hidden[hidden.length - 1]?.index ?? -1
	}, [hidden, announced])

	const [ack, setAck] = useState('')
	const ackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const acknowledge = (text: string) => {
		setAck(text)
		if (ackTimer.current) clearTimeout(ackTimer.current)
		ackTimer.current = setTimeout(() => setAck(''), 2500)
	}
	useEffect(
		() =>
			on('hidden-ready', (msg) => {
				setAnnounced(msg.slideIndex)
				acknowledge('new hidden slide ready')
			}),
		[]
	)
	useEffect(() => () => void (ackTimer.current && clearTimeout(ackTimer.current)), [])

	const toggleAuto = () => setMode(state.mode === 'record' ? 'record' : 'present', !state.auto, state.deckId ?? deck?.id)
	const goto = (p: { slide: number; step: number } | null) => p && nav('goto', { slide: p.slide, step: p.step })

	const typed = useKeys({
		first: () => goto(firstPos(slides)),
		last: () => goto(lastPos(slides)),
		toggleBlack: () => setBlack(!state.black),
		escape: () => setHelpOpen(false),
		extra: {
			g: () => (newest >= 0 ? goto({ slide: newest, step: 0 }) : acknowledge('no hidden slides')),
			// the public build has no agent: nothing to ask, nothing to auto-advance
			...(!PUBLIC && {
				h: () => {
					requestHidden()
					acknowledge('asked ✓')
				},
				a: toggleAuto,
			}),
			'?': () => setHelpOpen((o) => !o),
			'/': () => setHelpOpen((o) => !o),
		},
	})

	// Timer (click to reset) and wall clock.
	const now = useNow(1000)
	const [startedAt, setStartedAt] = useState(Date.now())
	const secs = Math.max(0, Math.floor((now - startedAt) / 1000))
	const h = Math.floor(secs / 3600)
	const elapsed = h
		? `${h}:${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}`
		: `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`
	const d = new Date(now)
	const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`

	const recentFinals = finals.slice(-4)

	return (
		<div className="rz-speaker">
			<header className="rz-bar">
				<div className="rz-where">
					<span className="rz-title">{deck?.title ?? ''}</span>
					<span className="rz-pos">
						<b>{slides.length ? state.slideIndex + 1 : '–'}</b>
						<span className="rz-of"> / {slides.length || '–'}</span>
						{stepCount > 1 && ` · step ${state.step + 1}/${stepCount}`}
						{slide?.hidden && <span className="rz-tag rz-hidden-tag">hidden</span>}
					</span>
					{typed && <span className="rz-typed">go to {typed}↵</span>}
				</div>

				<div className="rz-modes">
					<span className={`rz-mode rz-mode-${state.mode}`}>
						<i className="rz-dot" />
						{MODE_LABEL[state.mode]}
					</span>
					{!PUBLIC && (
						<button className={`rz-auto${state.auto ? ' rz-on' : ''}`} onClick={toggleAuto} title="Let the agent advance (a)">
							Auto {state.auto ? 'on' : 'off'}
						</button>
					)}
					{!PUBLIC && state.mode !== 'idle' && <button className="rz-auto" disabled={stopping} onClick={async () => {
						setStopping(true)
						try { await micStop(); setMode('idle') } finally { setStopping(false) }
					}}>{stopping ? 'Finishing…' : 'Stop & update notes'}</button>}
					{notesStatus && <span role="status" title={notesStatus.message}>{notesStatus.message}</span>}
					{state.black && (
						<span className="rz-tag rz-black-tag" title="b to restore">
							Audience black
						</span>
					)}
					<MicToggle variant="speaker" />
					{!connected && <span className="rz-offline">reconnecting…</span>}
				</div>

				<div className="rz-time">
					<span className="rz-elapsed" onClick={() => setStartedAt(Date.now())} title="Click to reset">
						{elapsed}
					</span>
					<span className="rz-clock">{clock}</span>
					{!PUBLIC && (
						<span className="rz-agent">
							{state.agentMessage && <span className="rz-agent-msg">{state.agentMessage}</span>}
							<Orb status={state.agent} message={state.agentMessage} />
						</span>
					)}
				</div>
			</header>

			<main className="rz-main">
				<section className="rz-current">
					<div className="rz-stage-wrap" {...clickNav()}>
						{deck && (
							<Stage
								deck={deck}
								version={version}
								slideIndex={state.slideIndex}
								step={state.step}
								align="start"
								onEditor={setEditor}
								onLoaded={(ed) => onLoaded(ed)}
								onFit={setFit}
							>
								{fit && <div className="rz-slide-card" style={{ left: fit.left, top: fit.top, width: fit.width, height: fit.height }} />}
								<Highlights editor={editor} slideIndex={state.slideIndex} fit={fit} slideW={deck.width || 1000} />
							</Stage>
						)}
					</div>
					<div className="rz-script">
						{scriptLine ? <p className="rz-line">{scriptLine}</p> : <p className="rz-line rz-empty">No script for this step.</p>}
						{nextScriptLine && <p className="rz-then">then: {nextScriptLine}</p>}
					</div>
				</section>

				<aside className="rz-side">
					<div className="rz-panel rz-next">
						<div className="rz-label">{nextLabel}</div>
						<div className="rz-next-stage">
							{deck && next ? (
								<Stage deck={deck} version={version} slideIndex={next.slide} step={next.step} />
							) : (
								<div className="rz-end">End of deck</div>
							)}
						</div>
					</div>

					{!PUBLIC && cues.length > 0 && (
						<div className="rz-panel rz-cues">
							<div className="rz-label">Cues</div>
							<div className="rz-chips">
								{cues.map((c) => (
									<span
										key={c.id}
										className={`rz-chip${c.armed ? ' rz-armed' : ''}${c.heard ? ' rz-heard' : ''}`}
										title={`${c.action === 'next' ? 'next slide' : 'next step'}${c.atStep !== undefined ? ` · at step ${c.atStep + 1}` : ''}`}
									>
										“{c.phrase}” <small>{c.action === 'next' ? '⇥' : '›'}</small>
									</span>
								))}
							</div>
						</div>
					)}

					{!PUBLIC && deck && slide ? <SpeakerNotes key={`${deck.id}:${slide.id}`} deckId={deck.id} slideId={slide.id} html={slide.meta.notes ?? ''} /> : <div className="rz-panel rz-notes">
						<div className="rz-label">Notes</div>
						{notes ? (
							<div className="rz-notes-body" dangerouslySetInnerHTML={{ __html: notes }} />
						) : (
							<div className="rz-notes-body rz-empty">No notes.</div>
						)}
					</div>}

					<div className="rz-panel rz-hidden">
						<div className="rz-label">
							Hidden slides
							{ack ? <span className="rz-ack">{ack}</span> : <span className="rz-keys">{PUBLIC ? 'g jump' : 'g jump · h ask'}</span>}
						</div>
						{deck && <HiddenStrip deck={deck} version={version} hidden={hidden} newest={newest} current={state.slideIndex} />}
					</div>
				</aside>
			</main>

			<footer className="rz-ticker" aria-live="off">
				<div className="rz-lines">
					{PUBLIC && <span className="rz-idle">→ next · ← previous · b black screen · g hidden slide · ? keys</span>}
					{!PUBLIC && recentFinals.map((u, k) => (
						<span className="rz-final" key={`${u.t0}-${k}`}>
							{u.text + ' '}
						</span>
					))}
					{!PUBLIC && partial && <span className="rz-partial">{partial}</span>}
					{!PUBLIC && !recentFinals.length && !partial && <span className="rz-idle">Transcript appears here while you speak.</span>}
				</div>
				<button className="rz-help-btn" onClick={() => setHelpOpen((o) => !o)} title="Keys (?)">
					?
				</button>
			</footer>

			{helpOpen && (
				<div className="rz-help" onClick={() => setHelpOpen(false)}>
					<div className="rz-card" onClick={(e) => e.stopPropagation()}>
						<h3>Keys</h3>
						<dl>
							<dt>→ ↓ Space PgDn Enter</dt>
							<dd>next step or slide</dd>
							<dt>← ↑ PgUp Backspace</dt>
							<dd>previous</dd>
							<dt>Home / End</dt>
							<dd>first / last slide</dd>
							<dt>
								<i>n</i> Enter
							</dt>
							<dd>
								go to slide <i>n</i>
							</dd>
							<dt>b .</dt>
							<dd>black audience screen</dd>
							<dt>g</dt>
							<dd>jump to the newest hidden slide</dd>
							{!PUBLIC && (
								<>
									<dt>h</dt>
									<dd>ask the agent for a hidden slide</dd>
									<dt>a</dt>
									<dd>auto-advance on / off</dd>
								</>
							)}
							<dt>?</dt>
							<dd>this help</dd>
						</dl>
					</div>
				</div>
			)}
		</div>
	)
}
