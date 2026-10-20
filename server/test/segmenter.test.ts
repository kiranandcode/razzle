// The browser ASR's segmenter (tldraw/apps/razzle/src/asr/segmenter.ts) on synthetic PCM, and
// against the server's AudioPipeline: both must cut the same audio into the same segments.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Segmenter, SEG_TUNING, RATE, type SegEvent } from '../../tldraw/apps/razzle/src/asr/segmenter.ts'
import { AudioPipeline, AUDIO_TUNING } from '../audio.ts'

// deterministic noise
function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1
}

/** int16 PCM from [ms, amplitude] pieces: amplitude 0 = near-silence (tiny noise), else noise at that level. */
function pcm(pieces: [number, number][], seed = 1): Int16Array {
  const r = rng(seed)
  const n = pieces.reduce((a, [ms]) => a + Math.round(ms * RATE / 1000), 0)
  const out = new Int16Array(n)
  let i = 0
  for (const [ms, amp] of pieces) {
    const len = Math.round(ms * RATE / 1000)
    for (let k = 0; k < len; k++, i++) {
      // speech-like: 250 ms bursts with 80 ms dips (syllables), so the adaptive floor stays low
      const voiced = amp && (k % Math.round(0.33 * RATE)) < 0.25 * RATE
      out[i] = Math.round((voiced ? amp : 0.0003) * r() * 32767)
    }
  }
  return out
}

const toFloat = (x: Int16Array) => Float32Array.from(x, v => v / 32768)

function run(x: Int16Array, chunk = 1234): SegEvent[] {
  const seg = new Segmenter(0)
  const f = toFloat(x)
  const out: SegEvent[] = []
  for (let i = 0; i < f.length; i += chunk) out.push(...seg.push(f.subarray(i, i + chunk)))
  out.push(...seg.flush())
  return out
}

test('tuning matches the server pipeline', () => {
  assert.deepEqual(SEG_TUNING, AUDIO_TUNING)
})

test('silence makes no segments', () => {
  assert.deepEqual(run(pcm([[5000, 0]])), [])
})

test('one phrase: start with pre-roll, close after 500 ms of silence', () => {
  const ev = run(pcm([[1000, 0], [1500, 0.2], [1500, 0]]))
  assert.deepEqual(ev.map(e => e.type), ['start', 'close'])
  const [start, close] = ev as [Extract<SegEvent, { type: 'start' }>, Extract<SegEvent, { type: 'close' }>]
  // speech starts at 1000 ms; the segment opens 60 ms in and keeps 200 ms + 60 ms of pre-roll
  assert.ok(start.t0 >= 700 && start.t0 <= 1000, `t0 ${start.t0}`)
  assert.equal(close.flush, false)
  // ends up to 200 ms after the last speech (2500 ms)
  assert.ok(close.t1 >= 2500 && close.t1 <= 2720, `t1 ${close.t1}`)
  assert.equal(close.pcm.length, (close.t1 - close.t0) * RATE / 1000)
})

test('two phrases with a short gap stay one segment; a long gap splits them', () => {
  assert.deepEqual(run(pcm([[500, 0], [800, 0.2], [300, 0], [800, 0.2], [1000, 0]])).map(e => e.type), ['start', 'close'])
  assert.deepEqual(run(pcm([[500, 0], [800, 0.2], [900, 0], [800, 0.2], [1000, 0]])).map(e => e.type), ['start', 'close', 'start', 'close'])
})

test('a segment closes at 12 s of continuous speech and the next one opens', () => {
  const ev = run(pcm([[500, 0], [15000, 0.2], [1000, 0]]))
  assert.deepEqual(ev.map(e => e.type), ['start', 'close', 'start', 'close'])
  const first = ev[1] as Extract<SegEvent, { type: 'close' }>
  assert.equal(first.t1 - first.t0, 12000)
})

test('flush closes the open segment', () => {
  const ev = run(pcm([[500, 0], [2000, 0.2]]))
  assert.deepEqual(ev.map(e => e.type), ['start', 'close'])
  assert.equal((ev[1] as Extract<SegEvent, { type: 'close' }>).flush, true)
})

test('the open segment is visible for partials', () => {
  const seg = new Segmenter(1000)
  seg.push(toFloat(pcm([[300, 0], [700, 0.2]])))
  const open = seg.open
  assert.ok(open)
  assert.ok(open.ms >= 600 && open.ms <= 1000, `ms ${open.ms}`)
  assert.equal(open.pcm().length, open.ms * RATE / 1000)
  assert.ok(open.t0 >= 1000)
})

test('the server pipeline cuts the same audio into the same segments', async () => {
  const x = pcm([[700, 0], [1200, 0.15], [300, 0], [900, 0.3], [800, 0], [13000, 0.1], [600, 0], [150, 0.4], [900, 0], [2000, 0.05], [1000, 0]], 7)
  const browser = run(x).filter(e => e.type !== 'drop').map(e => e.type === 'start' ? { type: e.type, segId: e.segId, t0: e.t0 } : { type: 'final', segId: e.segId, t0: e.t0, t1: (e as any).t1 })

  const p = new AudioPipeline()
  // no whisper: both passes return a fixed text immediately
  p.fast.transcribe = async () => 'x'
  p.final.transcribe = async () => 'x'
  const server: any[] = []
  p.on('segment-start', ({ segId, t0 }) => server.push({ type: 'start', segId, t0 }))
  p.on('final', ({ segId, t0, t1 }) => server.push({ type: 'final', segId, t0, t1 }))
  ;(p as any).startedAt = 0
  const buf = Buffer.from(x.buffer, x.byteOffset, x.byteLength)
  for (let i = 0; i < buf.length; i += 2468) (p as any).onData(buf.subarray(i, i + 2468))
  ;(p as any).closeSegment(true)
  await p.drain()
  // the server emits every final after its segment-start; compare as ordered by segment
  const bySeg = (a: any[]) => a.slice().sort((u, v) => u.segId - v.segId || (u.type === 'start' ? -1 : 1))
  assert.ok(browser.length >= 8, `segments: ${browser.length / 2}`)
  assert.deepEqual(bySeg(browser), bySeg(server))
})
