// Cue matching on the live transcript. Pure apart from the tracker's own memory.
//
// A cue fires when its phrase appears in the newest words since the last nav.
// Transcripts arrive as repeated partials of an open speech segment and then one
// final per segment, so "since the last nav" is tracked per segment: at each nav
// the words already heard in every unfinished segment are skipped, and a cue fires
// at most once per segment.

export interface Cue { id: string, phrase: string, action: 'next' | 'step', atStep?: number }

export function tokens(text: string): string[] {
  return text.toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ') // whisper annotations: [BLANK_AUDIO], (music)
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/'/g, '')
    .split(/\s+/).filter(Boolean)
}

/** Index just past the first occurrence of `phrase` in `words` at or after `from`, or -1. */
export function findPhrase(words: string[], phrase: string[], from = 0): number {
  if (!phrase.length) return -1
  outer: for (let i = Math.max(0, from); i + phrase.length <= words.length; i++) {
    for (let j = 0; j < phrase.length; j++) if (words[i + j] !== phrase[j]) continue outer
    return i + phrase.length
  }
  return -1
}

export interface CueHit { cue: Cue, segId: number, end: number }

export class CueTracker {
  // words of each unfinished segment heard so far (from its newest partial)
  private heard = new Map<number, number>()
  // per segment: words before this index were spoken before the last nav
  private skip = new Map<number, number>()
  private fired = new Map<number, Set<string>>()

  /** Called on every accepted nav. */
  onNav(): void {
    for (const [seg, n] of this.heard) this.skip.set(seg, Math.max(this.skip.get(seg) ?? 0, n))
  }

  /** Feed a partial or final for a segment; returns the cue to fire, if any. */
  feed(segId: number, text: string, isFinal: boolean, cues: Cue[], step: number): CueHit | null {
    const words = tokens(text)
    if (isFinal) this.heard.delete(segId); else this.heard.set(segId, words.length)
    const from = this.skip.get(segId) ?? 0
    const fired = this.fired.get(segId) ?? new Set<string>()
    let best: CueHit | null = null
    for (const cue of cues) {
      if (cue.atStep !== undefined && cue.atStep !== step) continue
      if (fired.has(cue.id)) continue
      const end = findPhrase(words, tokens(cue.phrase), from)
      if (end >= 0 && (!best || end < best.end)) best = { cue, segId, end }
    }
    if (best) {
      fired.add(best.cue.id)
      this.fired.set(segId, fired)
      this.skip.set(segId, Math.max(from, best.end))
    }
    if (isFinal) { this.skip.delete(segId); this.fired.delete(segId) }
    return best
  }
}
