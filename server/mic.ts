// Speech events from either audio source, and the browser mic (RAZZLE_AUDIO=browser).
//
// Both sources produce the same events, which server.ts ingests on one path:
//   segment-start  speech began                 (segInfo is tagged with the slide and step showing)
//   partial        newest text of the open segment   (broadcast, cue matching)
//   late-partial   text of a segment that has closed (cue matching only)
//   pause          the closed segment's fast text    (broadcast for the director, cue matching)
//   final          the finished segment              (broadcast, cue matching, the take)
//
// In browser mode one client holds the mic ({t:'mic', on:true}; the latest claim wins) and
// sends {t:'asr', kind, segId, text?, t0?, t1?}. Its segment ids are its own; every claim gets
// fresh server ids (a monotonic counter, which the director compares), so ids from an earlier
// claim or connection never collide with later ones. Messages from any other client, and
// segments started while the server is idle, are dropped.

export type AsrEvent =
  | { kind: 'segment-start', segId: number, t0: number }
  | { kind: 'partial' | 'late-partial' | 'pause', segId: number, text: string }
  | { kind: 'final', segId: number, text: string, t0: number, t1: number }

const MAX_TEXT = 4000
const DAY = 86400e3

const timeOr = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v - fallback) < DAY ? v : fallback

const clientSegKey = (v: unknown): string | null =>
  (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length > 0 && v.length <= 64) ? String(v) : null

export class BrowserMic<C = unknown> {
  holder: C | null = null
  private claimNo = 0
  private nextSeg = 1
  // client segment id -> server segment id, for the current claim
  private segs = new Map<string, { id: number, t0: number, closed: boolean }>()

  /** `client` takes the mic. Returns the previous holder (to tell it), if another client.
   *  Segments still open from the previous claim are closed with an empty final. */
  claim(client: C): { previous: C | null, ended: AsrEvent[] } {
    const previous = this.holder !== client ? this.holder : null
    const ended = this.endOpen()
    this.holder = client
    this.claimNo++
    return { previous, ended }
  }

  /** `client` lets go of the mic (or disconnected). No-op unless it holds it. */
  release(client: C): { released: boolean, ended: AsrEvent[] } {
    if (this.holder !== client || client === null) return { released: false, ended: [] }
    this.holder = null
    return { released: true, ended: this.endOpen() }
  }

  get active(): boolean { return this.holder !== null }
  get claims(): number { return this.claimNo }

  /** Translate one `asr` message into a server event, or null to drop it. `accepting`
   *  is false while the server is idle: no new segments start then, but segments already
   *  under way may still close (their finals belong to the take being closed). */
  translate(client: C, msg: any, accepting: boolean, now = Date.now()): AsrEvent | null {
    if (client !== this.holder || !msg || typeof msg !== 'object') return null
    const key = clientSegKey(msg.segId)
    if (key === null) return null
    const text = typeof msg.text === 'string' ? msg.text.slice(0, MAX_TEXT) : ''
    const seg = this.segs.get(key)
    switch (msg.kind) {
      case 'segment-start': {
        if (!accepting || seg) return null
        const id = this.nextSeg++
        const t0 = timeOr(msg.t0, now)
        this.segs.set(key, { id, t0, closed: false })
        return { kind: 'segment-start', segId: id, t0 }
      }
      case 'partial':
        if (!seg) return null
        // a partial that lands after its segment's pause is stale: cue matching only
        return { kind: seg.closed ? 'late-partial' : 'partial', segId: seg.id, text }
      case 'pause':
        if (!seg) return null
        seg.closed = true
        return { kind: 'pause', segId: seg.id, text }
      case 'final': {
        if (!seg) return null
        this.segs.delete(key)
        return { kind: 'final', segId: seg.id, text, t0: timeOr(msg.t0, seg.t0), t1: timeOr(msg.t1, now) }
      }
    }
    return null
  }

  private endOpen(): AsrEvent[] {
    const now = Date.now()
    const out: AsrEvent[] = [...this.segs.values()].map(s => ({ kind: 'final' as const, segId: s.id, text: '', t0: s.t0, t1: now }))
    this.segs.clear()
    return out
  }
}
