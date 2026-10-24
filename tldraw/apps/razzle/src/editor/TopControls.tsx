// The studio's top bar, in tldraw's own corners: deck title and save state beside the main
// menu (top left); inspector toggles, the agent dot, Record, Notes and Present (top right);
// the live caption while recording (top centre).
import { useEffect, useRef, useState } from 'react'
import {
	PORTRAIT_BREAKPOINT,
	TldrawUiButton,
	TldrawUiButtonIcon,
	TldrawUiButtonLabel,
	TldrawUiDropdownMenuContent,
	TldrawUiDropdownMenuRoot,
	TldrawUiDropdownMenuTrigger,
	TldrawUiMenuContextProvider,
	TldrawUiMenuGroup,
	TldrawUiMenuItem,
	TldrawUiRow,
	TldrawUiToolbar,
	useBreakpoint,
	useEditor,
	useTldrawUiComponents,
	useToasts,
	useValue,
} from 'tldraw'
import { micStart, micStop, useAutoMic, useBrowserMic } from '../asr/mic'
import { MicToggle } from '../asr/MicToggle'
import { PUBLIC } from '../model/base'
import { nav, setMode, useRazzle } from '../model/client'
import { generateNotes } from '../model/deck'
import { SaveStatus } from '../model/persist'
import { useStudio } from './context'
import { presentHere, presentWithApp, startIndex } from './presenting'
import { shareDeck } from './sharing'
import { $inspector, InspectorTab } from './state'

export function RazzleMenuPanel() {
	const { MainMenu, QuickActions, ActionsMenu } = useTldrawUiComponents()
	const breakpoint = useBreakpoint()
	return (
		<nav className="tlui-menu-zone rz-menu-zone">
			<TldrawUiRow>
				{MainMenu && <MainMenu />}
				<DeckTitle />
				<SaveState />
				{breakpoint >= PORTRAIT_BREAKPOINT.TABLET && (
					<TldrawUiToolbar orientation="horizontal" label="Actions">
						{QuickActions && <QuickActions />}
						{ActionsMenu && <ActionsMenu />}
					</TldrawUiToolbar>
				)}
			</TldrawUiRow>
		</nav>
	)
}

function DeckTitle() {
	const { sync, deck } = useStudio()
	const title = useValue('deck title', () => sync?.$title.get() ?? deck.title, [sync])
	const [editing, setEditing] = useState(false)
	const ref = useRef<HTMLInputElement>(null)
	useEffect(() => {
		if (editing) ref.current?.select()
	}, [editing])
	if (editing) {
		return (
			<input
				ref={ref}
				className="rz-deck-title-input"
				defaultValue={title}
				onKeyDown={(e) => {
					e.stopPropagation()
					if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
					if (e.key === 'Escape') setEditing(false)
				}}
				onBlur={(e) => {
					const v = e.target.value.trim()
					if (v) sync?.setTitle(v)
					setEditing(false)
				}}
			/>
		)
	}
	return (
		<button className="rz-deck-title" title="Rename the deck" onClick={() => setEditing(true)}>
			{title || 'Untitled deck'}
		</button>
	)
}

const STATUS_TEXT: Record<SaveStatus, string> = {
	saved: 'Saved',
	saving: 'Saving…',
	edited: 'Edited',
	local: 'Saved in browser',
	error: 'Not saved',
}

function SaveState() {
	const { sync } = useStudio()
	const status = useValue('save status', () => sync?.$status.get() ?? 'saved', [sync])
	const error = useValue('save error', () => sync?.$error.get() ?? '', [sync])
	return (
		<span
			className="rz-save-state"
			data-status={status}
			title={PUBLIC ? 'Kept in this browser only; export the deck from the main menu.' : status === 'local' ? `The server is not reachable${error ? ` (${error})` : ''}; edits are kept in this browser and sent when it is back.` : error || undefined}
			onClick={() => sync?.flush()}
		>
			{STATUS_TEXT[status]}
		</span>
	)
}

export function RazzleSharePanel() {
	return (
		<div className="rz-share-zone">
			{!PUBLIC && <AgentDot />}
			<InspectorToggle tab="builds" icon="rz-builds" label="Builds" />
			<InspectorToggle tab="speech" icon="rz-speech" label="Speech" />
			{!PUBLIC && (
				<>
					<span className="rz-divider" />
					<MicToggle variant="studio" />
					<RecordButton />
					<NotesButton />
					<ShareButton />
					<PresentButton />
				</>
			)}
			{PUBLIC && (
				<>
					<span className="rz-divider" />
					<ShareButton />
					<PresentHereButton />
				</>
			)}
		</div>
	)
}

function InspectorToggle({ tab, icon, label }: { tab: InspectorTab; icon: string; label: string }) {
	const open = useValue('inspector', () => $inspector.get() === tab, [tab])
	return (
		<TldrawUiButton type="normal" className="rz-top-btn" isActive={open} data-active={open} title={`${label} panel`} onClick={() => $inspector.set(open ? null : tab)}>
			<TldrawUiButtonIcon icon={icon} small />
			<TldrawUiButtonLabel>{label}</TldrawUiButtonLabel>
		</TldrawUiButton>
	)
}

const AGENT_TEXT: Record<string, string> = {
	offline: 'No agent connected',
	listening: 'Agent listening',
	thinking: 'Agent thinking',
	acting: 'Agent acting',
	ready: 'Agent ready',
}

function AgentDot() {
	const connected = useRazzle((s) => s.connected)
	const agent = useRazzle((s) => s.state.agent)
	const message = useRazzle((s) => s.state.agentMessage)
	const status = connected ? agent : 'disconnected'
	const title = connected ? `${AGENT_TEXT[agent] ?? agent}${message ? `: ${message}` : ''}` : 'Not connected to the Razzle server'
	return <span className="rz-agent-dot" data-status={status} title={title} aria-label={title} />
}

function RecordButton() {
	const { deck, sync } = useStudio()
	const editor = useEditor()
	const toasts = useToasts()
	const [stopping, setStopping] = useState(false)
	const ownsRun = useRef(false)
	const connected = useRazzle((s) => s.connected)
	const mode = useRazzle((s) => s.state.mode)
	const recording = useRazzle((s) => !!s.state.takeId && s.state.deckId === deck.id)
	const micActive = useRazzle((s) => s.state.mic.active)
	const slide = useValue('recording slide', () => startIndex(editor), [editor])
	useEffect(() => {
		if (mode === 'idle') ownsRun.current = false
		if (ownsRun.current && recording && mode === 'record') nav('goto', { slide, step: 0 })
	}, [recording, mode, slide])
	// browser mic (RAZZLE_AUDIO=browser): Record takes the mic, and lets it go when recording stops
	const browserMic = useBrowserMic()
	useAutoMic(mode !== 'idle', { claim: false })
	return recording ? (
		<TldrawUiButton type="normal" className="rz-top-btn rz-recording" disabled={stopping} title="Stop this run and update notes from what you said" onClick={async () => {
			setStopping(true)
			try { await micStop(); setMode('idle') } finally { setStopping(false) }
		}}>
			<span className="rz-rec-dot" />
			<TldrawUiButtonLabel>{stopping ? 'Finishing…' : 'Stop & update'}</TldrawUiButtonLabel>
		</TldrawUiButton>
	) : (
		<TldrawUiButton
			type="normal"
			className="rz-top-btn rz-record-btn"
			disabled={!connected}
			title={connected ? 'Rehearse: every sentence is stored against its slide and step' : 'Needs the Razzle server'}
			onClick={async () => {
				try {
					await sync?.flush()
					ownsRun.current = true
					setMode(mode === 'present' ? 'present' : 'record', false, deck.id)
					if (mode !== 'present') nav('goto', { slide: startIndex(editor), step: 0 })
					if (browserMic && !micActive) void micStart('auto')
				} catch (e) { toasts.addToast({ title: 'Could not record', description: String(e), severity: 'error' }) }
			}}
		>
			<TldrawUiButtonIcon icon="rz-record" small />
			<TldrawUiButtonLabel>Record</TldrawUiButtonLabel>
		</TldrawUiButton>
	)
}

function NotesButton() {
	const { deck, sync } = useStudio()
	const connected = useRazzle((s) => s.connected)
	const [busy, setBusy] = useState(false)
	const progress = useRazzle((s) => s.notesStatus?.deckId === deck.id ? s.notesStatus : undefined)
	const recording = useRazzle((s) => s.state.deckId === deck.id && !!s.state.takeId)
	const toasts = useToasts()
	return (
		<TldrawUiButton
			type="normal"
			className="rz-top-btn"
			disabled={!connected || busy || progress?.status === 'writing' || recording}
			title={progress?.message || 'Update notes from finished practice runs with Codex'}
			onClick={async () => {
				setBusy(true)
				try {
					await sync?.flush()
					const fresh = await generateNotes(deck.id)
					sync?.applyServerDeck(fresh)
					toasts.addToast({ title: 'Notes written', description: 'Scripts are in the Speech panel.', severity: 'success' })
				} catch (e) {
					toasts.addToast({ title: 'Could not write notes', description: e instanceof Error ? e.message : String(e), severity: 'error' })
				} finally {
					setBusy(false)
				}
			}}
		>
			<TldrawUiButtonIcon icon="rz-notes" small />
			<TldrawUiButtonLabel>{busy || progress?.status === 'writing' ? 'Writing…' : progress?.status === 'error' ? 'Retry notes' : 'Notes'}</TldrawUiButtonLabel>
		</TldrawUiButton>
	)
}

function PresentButton() {
	const editor = useEditor()
	const { deck, sync } = useStudio()
	const connected = useRazzle((s) => s.connected)
	const toasts = useToasts()
	const start = async () => {
		try {
			await sync?.flush()
			await presentWithApp(editor, deck.id)
		} catch (e) {
			toasts.addToast({ title: 'Could not present', description: e instanceof Error ? e.message : String(e), severity: 'error' })
		}
	}
	return (
		<div className="rz-split">
			<TldrawUiButton type="primary" className="rz-top-btn rz-split-main" disabled={!connected} title="Present with the presenter app, from this slide" onClick={start}>
				<TldrawUiButtonIcon icon="rz-play" small />
				<TldrawUiButtonLabel>Present</TldrawUiButtonLabel>
			</TldrawUiButton>
			<TldrawUiDropdownMenuRoot id="razzle-present">
				<TldrawUiDropdownMenuTrigger>
					<TldrawUiButton type="primary" className="rz-top-btn rz-split-more" title="More ways to present">
						<TldrawUiButtonIcon icon="chevron-down" small />
					</TldrawUiButton>
				</TldrawUiDropdownMenuTrigger>
				<TldrawUiDropdownMenuContent side="bottom" align="end" alignOffset={0} sideOffset={6}>
					<TldrawUiMenuContextProvider type="menu" sourceId="menu">
						<TldrawUiMenuGroup id="present">
							<TldrawUiMenuItem id="present-app" label="With the presenter app" icon="rz-present" disabled={!connected} onSelect={start} />
							<TldrawUiMenuItem
								id="present-here"
								label="In this browser"
								icon="external-link"
								onSelect={async () => {
									await sync?.flush()
									presentHere(editor, deck.id)
								}}
							/>
						</TldrawUiMenuGroup>
					</TldrawUiMenuContextProvider>
				</TldrawUiDropdownMenuContent>
			</TldrawUiDropdownMenuRoot>
		</div>
	)
}

/** A link that carries the deck (src/model/share.ts), copied to the clipboard. */
function ShareButton() {
	const editor = useEditor()
	const { deck, sync } = useStudio()
	const toasts = useToasts()
	const [busy, setBusy] = useState(false)
	return (
		<TldrawUiButton
			type="normal"
			className="rz-top-btn"
			disabled={busy}
			title="Copy a link that carries the whole deck: anyone with it can view the talk"
			onClick={async () => {
				setBusy(true)
				await shareDeck(editor, deck, sync?.$title.get() ?? deck.title, sync?.flush, (t) => toasts.addToast(t))
				setBusy(false)
			}}
		>
			<TldrawUiButtonIcon icon="link" small />
			<TldrawUiButtonLabel>Share</TldrawUiButtonLabel>
		</TldrawUiButton>
	)
}

/** The public studio presents in this browser only (no server, no presenter app). */
function PresentHereButton() {
	const editor = useEditor()
	const { deck, sync } = useStudio()
	return (
		<div className="rz-split">
			<TldrawUiButton
				type="primary"
				className="rz-top-btn"
				title="Present from this slide: the slides in this tab, the speaker view in a new window"
				onClick={async () => {
					await sync?.flush()
					presentHere(editor, deck.id)
				}}
			>
				<TldrawUiButtonIcon icon="rz-play" small />
				<TldrawUiButtonLabel>Present</TldrawUiButtonLabel>
			</TldrawUiButton>
		</div>
	)
}

/** Top centre while recording: a pulsing dot and the live caption. */
export function RecordingCaption() {
	const mode = useRazzle((s) => s.state.mode)
	const partial = useRazzle((s) => s.partial)
	const last = useRazzle((s) => s.finals[s.finals.length - 1]?.text ?? '')
	if (mode !== 'record') return null
	const text = partial || last
	const tail = text.length > 90 ? '…' + text.slice(-89).replace(/^\S*\s/, '') : text
	return (
		<div className="rz-caption" aria-live="polite">
			<span className="rz-rec-dot" />
			<span className="rz-caption-label">Recording</span>
			<span className="rz-caption-text">{tail || 'Listening…'}</span>
		</div>
	)
}
