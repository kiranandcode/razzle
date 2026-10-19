// Audio pipeline: ffmpeg capture (mic or a file streamed in real time), an
// energy VAD that cuts speech into segments, and two whisper-server processes:
// a fast model for partials of the open segment and an accurate model for finals.
//
// Events (AudioPipeline extends EventEmitter):
//   'segment-start' {segId, t0}                 speech began (t0 = epoch ms)
//   'partial'       {segId, text}               newest transcription of the open segment
//   'final'         {segId, text, t0, t1}       finished segment (accurate model)
//   'started' {at}, 'stopped', 'source-ended', 'error' Error, 'log' string

import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import net from 'node:net'

const RATE = 16000
const FRAME = 320 // 20 ms
const FRAME_MS = 20

export const MODELS = {
  fast: process.env.RAZZLE_FAST_MODEL ?? '/Users/kirancodes/.whatwasIdoing/models/ggml-base.en.bin',
  final: process.env.RAZZLE_FINAL_MODEL ?? '/Users/kirancodes/models/whisper/ggml-large-v3-turbo-q5_0.bin',
}

export const AUDIO_TUNING = {
  partialEveryMs: 600,
  silenceToFinalMs: 500,
  maxWindowMs: 12000,
  prerollMs: 200,
  speechStartFrames: 3, // 60 ms of energy to open a segment
  minSegmentMs: 250,
}

// ---------- whisper-server management ----------

async function portFree(port: number): Promise<boolean> {
  return new Promise(res => {
    const s = net.createServer()
    s.once('error', () => res(false))
    s.listen(port, '127.0.0.1', () => s.close(() => res(true)))
  })
}

async function freePort(preferred: number): Promise<number> {
  for (let p = preferred; p < preferred + 50; p++) if (await portFree(p)) return p
  throw new Error(`no free port near ${preferred}`)
}

export class Whisper {
  name: string
  model: string
  preferredPort: number
  port = 0
  proc: ChildProcess | null = null
  private ready: Promise<void> | null = null

  constructor(name: string, model: string, preferredPort: number) {
    this.name = name; this.model = model; this.preferredPort = preferredPort
  }

  start(log: (s: string) => void): Promise<void> {
    if (this.ready) return this.ready
    this.ready = (async () => {
      this.port = await freePort(this.preferredPort)
      const threads = String(Math.max(2, Math.min(8, Number(process.env.RAZZLE_WHISPER_THREADS ?? 4))))
      this.proc = spawn('whisper-server', ['-m', this.model, '--host', '127.0.0.1', '--port', String(this.port), '-t', threads, '-nt'],
        { stdio: ['ignore', 'ignore', 'pipe'] })
      let tail = ''
      this.proc.stderr?.on('data', d => { tail = (tail + d.toString()).slice(-2000) })
      this.proc.on('exit', code => {
        if (this.proc) log(`whisper ${this.name} exited (${code})${code ? ': ' + tail.split('\n').slice(-3).join(' | ') : ''}`)
        this.proc = null; this.ready = null
      })
      const t0 = Date.now()
      while (Date.now() - t0 < 60000) {
        if (!this.proc) throw new Error(`whisper ${this.name} failed to start: ${tail.slice(-300)}`)
        try {
          const r = await fetch(`http://127.0.0.1:${this.port}/`)
          if (r.ok || r.status === 404) { log(`whisper ${this.name} ready on :${this.port} (${Date.now() - t0} ms)`); return }
        } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 150))
      }
      throw new Error(`whisper ${this.name} did not come up`)
    })()
    this.ready.catch(() => { this.ready = null })
    return this.ready
  }

  async transcribe(pcm: Int16Array, signal?: AbortSignal): Promise<string> {
    await this.start(() => {})
    const form = new FormData()
    form.append('file', new Blob([wav(pcm)], { type: 'audio/wav' }), 'a.wav')
    form.append('response_format', 'json')
    form.append('temperature', '0')
    const r = await fetch(`http://127.0.0.1:${this.port}/inference`, { method: 'POST', body: form, signal })
    if (!r.ok) throw new Error(`whisper ${this.name} HTTP ${r.status}`)
    const j = await r.json() as { text?: string }
    return cleanText(j.text ?? '')
  }

  stop(): void {
    const p = this.proc
    this.proc = null; this.ready = null
    if (p && p.exitCode === null) p.kill('SIGTERM')
  }
}

const HALLUCINATIONS = /^(thank you\.?|thanks for watching!?|you|\.|bye\.?)$/i

export function cleanText(t: string): string {
  const s = t.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
  return HALLUCINATIONS.test(s) ? '' : s
}

export function wav(pcm: Int16Array): Uint8Array<ArrayBuffer> {
  const data = pcm.byteLength
  const buf = Buffer.alloc(44 + data)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + data, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(data, 40)
  Buffer.from(pcm.buffer, pcm.byteOffset, data).copy(buf, 44)
  return buf
}

// ---------- energy VAD ----------

export class EnergyVad {
  private floor = 0.002 // adaptive noise floor (RMS, full scale = 1)
  isSpeech(frame: Int16Array): boolean {
    let s = 0
    for (let i = 0; i < frame.length; i++) { const v = frame[i] / 32768; s += v * v }
    const rms = Math.sqrt(s / frame.length)
    const threshold = Math.max(0.006, this.floor * 3)
    const speech = rms > threshold
    // floor follows quiet frames quickly and loud frames very slowly
    this.floor = speech ? this.floor * 0.9995 + rms * 0.0005 : this.floor * 0.95 + rms * 0.05
    this.floor = Math.min(Math.max(this.floor, 0.0005), 0.05)
    return speech
  }
}

// ---------- pipeline ----------

interface Segment { id: number, t0: number, frames: Int16Array[], lastSpeechFrame: number, finalized: boolean }

export class AudioPipeline extends EventEmitter {
  fast: Whisper
  final: Whisper
  private ff: ChildProcess | null = null
  private vad = new EnergyVad()
  private pending: Buffer = Buffer.alloc(0)
  private preroll: Int16Array[] = []
  private run = 0
  private seg: Segment | null = null
  private segCounter = 0
  private speechRun = 0
  private silenceRun = 0
  private partialTimer: NodeJS.Timeout | null = null
  private partialBusy = false
  private finalQueue: Promise<void> = Promise.resolve()
  private startedAt = 0
  private framesIn = 0
  // [audio offset ms, wall-clock arrival] per chunk received, for latency measurement
  private arrivals: [number, number][] = []

  constructor() {
    super()
    this.fast = new Whisper('fast', MODELS.fast, Number(process.env.RAZZLE_WHISPER_FAST_PORT ?? 8711))
    this.final = new Whisper('final', MODELS.final, Number(process.env.RAZZLE_WHISPER_FINAL_PORT ?? 8712))
  }

  get running(): boolean { return this.ff !== null }

  private log(s: string) { this.emit('log', s) }

  /** Load both models (idempotent). */
  warm(): Promise<void> {
    const l = (s: string) => this.log(s)
    return Promise.all([this.fast.start(l), this.final.start(l)]).then(() => {})
  }

  async start(): Promise<void> {
    if (this.ff) return
    const run = ++this.run
    await this.warm()
    if (run !== this.run) return // stopped while models were loading
    const file = process.env.RAZZLE_AUDIO_FILE
    const mic = process.env.RAZZLE_MIC ?? '0'
    const input = file ? ['-re', '-i', file] : ['-f', 'avfoundation', '-i', `:${mic}`]
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', ...input, '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-']
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    this.ff = ff
    this.pending = Buffer.alloc(0)
    this.framesIn = 0
    this.arrivals = []
    this.startedAt = Date.now()
    this.log(`capture: ${file ? 'file ' + file : 'mic :' + mic}`)
    this.emit('started', { at: this.startedAt })
    ff.stdout!.on('data', (d: Buffer) => this.onData(d))
    ff.stderr!.on('data', (d: Buffer) => this.log(`ffmpeg: ${d.toString().trim()}`))
    ff.on('exit', code => {
      if (this.ff !== ff) return
      this.ff = null
      this.stopPartials()
      this.closeSegment(true)
      this.log(`capture ended (${code})`)
      this.emit('source-ended')
    })
    this.partialTimer = setInterval(() => this.tickPartial(), AUDIO_TUNING.partialEveryMs)
  }

  stop(): void {
    this.run++
    this.stopPartials()
    const ff = this.ff
    this.ff = null
    if (ff && ff.exitCode === null) ff.kill('SIGTERM')
    this.closeSegment(true)
    this.emit('stopped')
  }

  /** Kill capture and both whisper servers. */
  shutdown(): void {
    this.stop()
    this.fast.stop(); this.final.stop()
  }

  /** Resolves when every queued final transcription has completed. */
  drain(): Promise<void> { return this.finalQueue }

  private stopPartials() {
    if (this.partialTimer) clearInterval(this.partialTimer)
    this.partialTimer = null
  }

  // wall-clock time of a frame, derived from the sample count (exact for file input)
  private frameTime(i: number): number { return this.startedAt + i * FRAME_MS }

  /** Wall-clock time at which the audio at `offsetMs` (from the start of capture) reached the server. */
  arrivalOf(offsetMs: number): number | null {
    for (const [ms, at] of this.arrivals) if (ms >= offsetMs) return at
    return null
  }

  private onData(d: Buffer) {
    if (this.arrivals.length < 20000) this.arrivals.push([(this.framesIn * FRAME + (this.pending.length + d.length) / 2) / RATE * 1000, Date.now()])
    this.pending = this.pending.length ? Buffer.concat([this.pending, d]) : d
    const bytes = FRAME * 2
    while (this.pending.length >= bytes) {
      const chunk = this.pending.subarray(0, bytes)
      this.pending = this.pending.subarray(bytes)
      const frame = new Int16Array(FRAME)
      for (let i = 0; i < FRAME; i++) frame[i] = chunk.readInt16LE(i * 2)
      this.onFrame(frame)
    }
  }

  private onFrame(frame: Int16Array) {
    const idx = this.framesIn++
    const speech = this.vad.isSpeech(frame)
    const T = AUDIO_TUNING
    if (!this.seg) {
      this.preroll.push(frame)
      const keep = T.prerollMs / FRAME_MS + T.speechStartFrames
      if (this.preroll.length > keep) this.preroll.shift()
      this.speechRun = speech ? this.speechRun + 1 : 0
      if (this.speechRun >= T.speechStartFrames) {
        const frames = this.preroll
        this.preroll = []
        this.seg = { id: ++this.segCounter, t0: this.frameTime(idx - frames.length + 1), frames, lastSpeechFrame: frames.length, finalized: false }
        this.silenceRun = 0
        this.emit('segment-start', { segId: this.seg.id, t0: this.seg.t0 })
      }
      return
    }
    const seg = this.seg
    seg.frames.push(frame)
    if (speech) { this.silenceRun = 0; seg.lastSpeechFrame = seg.frames.length } else this.silenceRun++
    const lenMs = seg.frames.length * FRAME_MS
    if (this.silenceRun * FRAME_MS >= T.silenceToFinalMs) this.closeSegment(false)
    else if (lenMs >= T.maxWindowMs) this.closeSegment(false)
  }

  private concat(frames: Int16Array[]): Int16Array {
    const out = new Int16Array(frames.length * FRAME)
    frames.forEach((f, i) => out.set(f, i * FRAME))
    return out
  }

  private closeSegment(flush: boolean) {
    const seg = this.seg
    if (!seg) return
    this.seg = null
    this.speechRun = 0
    seg.finalized = true
    // keep up to 200 ms after the last speech frame
    const keep = Math.min(seg.frames.length, seg.lastSpeechFrame + 10)
    const frames = seg.frames.slice(0, keep)
    const t1 = seg.t0 + frames.length * FRAME_MS
    if (frames.length * FRAME_MS < AUDIO_TUNING.minSegmentMs) return
    const pcm = this.concat(frames)
    // pad to >= 1.1 s: whisper.cpp rejects very short input
    const minLen = Math.ceil(RATE * 1.1)
    const padded = pcm.length >= minLen ? pcm : (() => { const p = new Int16Array(minLen); p.set(pcm); return p })()
    // fast pass over the closed segment, so a cue at the end of a phrase
    // fires without waiting for the accurate model
    if (!flush) this.fast.transcribe(padded).then(text => {
      if (text) this.emit('late-partial', { segId: seg.id, text })
    }, () => {})
    this.finalQueue = this.finalQueue.then(async () => {
      try {
        const t = Date.now()
        const text = await this.final.transcribe(padded)
        this.log(`final #${seg.id} ${(frames.length * FRAME_MS / 1000).toFixed(1)}s audio in ${Date.now() - t} ms`)
        this.emit('final', { segId: seg.id, text, t0: seg.t0, t1 })
      } catch (e) { this.emit('error', e as Error) }
    })
  }

  private async tickPartial() {
    const seg = this.seg
    if (!seg || this.partialBusy) return
    if (seg.frames.length * FRAME_MS < 400) return
    this.partialBusy = true
    try {
      const pcm = this.concat(seg.frames)
      const minLen = Math.ceil(RATE * 1.1)
      const padded = pcm.length >= minLen ? pcm : (() => { const p = new Int16Array(minLen); p.set(pcm); return p })()
      const text = await this.fast.transcribe(padded)
      // a partial that lands after its segment's final has been queued is stale
      if (!seg.finalized && text) this.emit('partial', { segId: seg.id, text })
      else if (seg.finalized && text) this.emit('late-partial', { segId: seg.id, text })
    } catch (e) {
      this.emit('error', e as Error)
    } finally {
      this.partialBusy = false
    }
  }
}
