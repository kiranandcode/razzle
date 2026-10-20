// Speech segmentation for the browser ASR: the same energy VAD and segment rules as the server's
// AudioPipeline (server/audio.ts; server/test/segmenter.test.ts checks that both cut the same
// audio identically). Pure: feed 16 kHz mono samples, get segment events back.
//
//   start  speech began (60 ms over the threshold); the segment keeps 200 ms of pre-roll
//   close  >= 500 ms of silence, or the segment reached 12 s; `pcm` keeps up to 200 ms after the
//          last speech frame. Segments shorter than 250 ms are dropped instead (`drop`).
// `flush()` closes the open segment (capture stopping) with `flush: true`.

export const RATE = 16000
export const FRAME = 320 // 20 ms
export const FRAME_MS = 20

// mirrors AUDIO_TUNING in server/audio.ts
export const SEG_TUNING = {
	partialEveryMs: 600,
	silenceToFinalMs: 500,
	maxWindowMs: 12000,
	prerollMs: 200,
	speechStartFrames: 3,
	minSegmentMs: 250,
}

export class EnergyVad {
	private floor = 0.002 // adaptive noise floor (RMS, full scale = 1)
	/** One frame of samples in [-1, 1]. */
	isSpeech(frame: Float32Array): boolean {
		let s = 0
		for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i]
		const rms = Math.sqrt(s / frame.length)
		const threshold = Math.max(0.006, this.floor * 3)
		const speech = rms > threshold
		// the floor follows quiet frames quickly and loud frames very slowly
		this.floor = speech ? this.floor * 0.9995 + rms * 0.0005 : this.floor * 0.95 + rms * 0.05
		this.floor = Math.min(Math.max(this.floor, 0.0005), 0.05)
		return speech
	}
}

export type SegEvent =
	| { type: 'start'; segId: number; t0: number }
	| { type: 'close'; segId: number; t0: number; t1: number; pcm: Float32Array; flush: boolean }
	| { type: 'drop'; segId: number }

interface Segment {
	id: number
	t0: number
	frames: Float32Array[]
	lastSpeechFrame: number
}

export class Segmenter {
	private vad = new EnergyVad()
	private pending = new Float32Array(FRAME)
	private pendingLen = 0
	private preroll: Float32Array[] = []
	private seg: Segment | null = null
	private segCounter = 0
	private speechRun = 0
	private silenceRun = 0
	private framesIn = 0
	private startedAt: number
	private tuning: typeof SEG_TUNING

	/** `startedAt`: wall-clock time (ms) of the first sample, so segment times are epoch ms. */
	constructor(startedAt = 0, tuning: typeof SEG_TUNING = SEG_TUNING) {
		this.startedAt = startedAt
		this.tuning = tuning
	}

	/** The open segment, for partial transcriptions. */
	get open(): { segId: number; t0: number; ms: number; silentMs: number; pcm: () => Float32Array } | null {
		const seg = this.seg
		if (!seg) return null
		return { segId: seg.id, t0: seg.t0, ms: seg.frames.length * FRAME_MS, silentMs: this.silenceRun * FRAME_MS, pcm: () => concat(seg.frames) }
	}

	/** Feed samples (any length); returns the events they caused, in order. */
	push(samples: Float32Array): SegEvent[] {
		const out: SegEvent[] = []
		let i = 0
		while (i < samples.length) {
			const n = Math.min(FRAME - this.pendingLen, samples.length - i)
			this.pending.set(samples.subarray(i, i + n), this.pendingLen)
			this.pendingLen += n
			i += n
			if (this.pendingLen === FRAME) {
				const frame = this.pending
				this.pending = new Float32Array(FRAME)
				this.pendingLen = 0
				this.onFrame(frame, out)
			}
		}
		return out
	}

	/** Close the open segment now (capture is stopping). */
	flush(): SegEvent[] {
		const out: SegEvent[] = []
		this.close(true, out)
		return out
	}

	private frameTime(i: number) {
		return this.startedAt + i * FRAME_MS
	}

	private onFrame(frame: Float32Array, out: SegEvent[]) {
		const idx = this.framesIn++
		const speech = this.vad.isSpeech(frame)
		const T = this.tuning
		if (!this.seg) {
			this.preroll.push(frame)
			const keep = T.prerollMs / FRAME_MS + T.speechStartFrames
			if (this.preroll.length > keep) this.preroll.shift()
			this.speechRun = speech ? this.speechRun + 1 : 0
			if (this.speechRun >= T.speechStartFrames) {
				const frames = this.preroll
				this.preroll = []
				this.seg = { id: ++this.segCounter, t0: this.frameTime(idx - frames.length + 1), frames, lastSpeechFrame: frames.length }
				this.silenceRun = 0
				out.push({ type: 'start', segId: this.seg.id, t0: this.seg.t0 })
			}
			return
		}
		const seg = this.seg
		seg.frames.push(frame)
		if (speech) {
			this.silenceRun = 0
			seg.lastSpeechFrame = seg.frames.length
		} else this.silenceRun++
		if (this.silenceRun * FRAME_MS >= T.silenceToFinalMs || seg.frames.length * FRAME_MS >= T.maxWindowMs) this.close(false, out)
	}

	private close(flush: boolean, out: SegEvent[]) {
		const seg = this.seg
		if (!seg) return
		this.seg = null
		this.speechRun = 0
		// keep up to 200 ms after the last speech frame
		const keep = Math.min(seg.frames.length, seg.lastSpeechFrame + 10)
		const frames = seg.frames.slice(0, keep)
		const t1 = seg.t0 + frames.length * FRAME_MS
		if (frames.length * FRAME_MS < this.tuning.minSegmentMs) {
			out.push({ type: 'drop', segId: seg.id })
			return
		}
		out.push({ type: 'close', segId: seg.id, t0: seg.t0, t1, pcm: concat(frames), flush })
	}
}

function concat(frames: Float32Array[]): Float32Array {
	const out = new Float32Array(frames.length * FRAME)
	frames.forEach((f, i) => out.set(f, i * FRAME))
	return out
}

/** RMS of a block, for the level meter. */
export function rms(x: Float32Array): number {
	let s = 0
	for (let i = 0; i < x.length; i++) s += x[i] * x[i]
	return x.length ? Math.sqrt(s / x.length) : 0
}
