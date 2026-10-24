import type { Take } from './notes.ts'
import type { Json } from './slides.ts'
import { stepCountOf } from './state.ts'

export interface DeliveryExample { text: string, ending: string, pauseMs: number, takeId: string }
export interface DeliveryStep { script: string, steps: number, examples: DeliveryExample[] }

/** Keep only clicks made after speech at that position. Backtracking and silent clicks
 * must not become examples of when to advance. Finals can arrive after the click. */
export function deliveryPatches(slides: Json[], takes: Take[]): Map<string, Json> {
  const patches = new Map<string, Json>()
  const rehearsals = takes.filter(t => t.workflow === 'rehearse' && t.endedAt).sort((a, b) => a.startedAt - b.startedAt)
  for (const s of slides) {
    const delivery: Record<string, DeliveryStep> = {}
    for (const take of rehearsals) {
      for (const tr of take.transitions ?? []) {
        if (tr.slideId !== s.id || tr.steps !== stepCountOf(s as any) || tr.script !== (s.razzle?.script?.[tr.step] ?? '')) continue
        const speech = take.utterances.filter(u => u.slideId === s.id && u.step === tr.step && (u.visitAt !== undefined ? u.visitAt === tr.enteredAt : u.t0 >= tr.enteredAt) && (u.recordedAt ?? u.t0) <= tr.at).sort((a, b) => a.t0 - b.t0)
        const last = speech.at(-1)
        if (!last || tr.at - last.t1 > 10000) continue
        const text = speech.map(u => u.text.trim()).filter(Boolean).join(' ').slice(-6000)
        const ending = last.text.replace(/\b(um+|uh+|erm|hmm+)\b/gi, '').trim().split(/\s+/).slice(-30).join(' ')
        if (!ending) continue
        const entry = delivery[tr.step] ??= { script: tr.script, steps: tr.steps, examples: [] }
        entry.examples = [...entry.examples, { text, ending, pauseMs: Math.max(0, Math.min(3000, tr.at - last.t1)), takeId: take.id }].slice(-3)
      }
    }
    if (Object.keys(delivery).length && JSON.stringify(delivery) !== JSON.stringify(s.razzle?.delivery)) patches.set(s.id, { delivery })
  }
  return patches
}

export function deliveryFor(slide: Json, step: number): DeliveryStep | undefined {
  const d = slide.razzle?.delivery?.[step] as DeliveryStep | undefined
  return d && d.script === (slide.razzle?.script?.[step] ?? '') && d.steps === stepCountOf(slide as any) ? d : undefined
}

export function cadenceDelay(example: DeliveryStep | undefined, speechEndedAt: number, now = Date.now()): number {
  const pauses = example?.examples.map(e => e.pauseMs).sort((a, b) => a - b) ?? []
  const pause = pauses.length ? pauses[Math.floor(pauses.length / 2)] : 0
  return Math.max(0, Math.min(3000, pause) - Math.max(0, now - speechEndedAt))
}
