import { expect, it } from 'vitest'
import type { MicView } from './mic'
import { transcriptStatus } from './transcriptStatus'

const view: MicView = { status: 'off', progress: null, level: 0, device: null, model: '', message: '', partialMs: null, pauseMs: null }
const context = { connected: true, active: true, browser: true, micActive: true }

it('distinguishes paused audio, startup, permission errors and active listening', () => {
	expect(transcriptStatus({ ...view, status: 'waiting' }, context)).toContain('Click Start audio')
	expect(transcriptStatus({ ...view, status: 'loading', progress: .5 }, context)).toContain('50%')
	expect(transcriptStatus({ ...view, status: 'error', message: 'Microphone permission was denied.' }, context)).toContain('permission was denied')
	expect(transcriptStatus({ ...view, status: 'listening' }, context)).toContain('Listening.')
	expect(transcriptStatus({ ...view, status: 'listening', message: 'Transcription failed: model error' }, context)).toContain('model error')
})

it('does not claim to be listening while disconnected, idle or switched off', () => {
	expect(transcriptStatus(view, { ...context, connected: false })).toContain('Reconnecting')
	expect(transcriptStatus(view, { ...context, active: false })).toContain('Start presenting')
	expect(transcriptStatus(view, { ...context, micActive: false })).toContain('Microphone off')
	expect(transcriptStatus(view, context)).toContain('another window')
})
