// LLM clients: Claude and Jev (typesafe.ai systemone).
//
// Claude is reached one of two ways: the Anthropic API when ANTHROPIC_API_KEY (or
// ANTHROPIC_AUTH_TOKEN) is set, else the Claude Code CLI (`claude -p`) logged in with the
// user's account (`claude login` or `claude setup-token` as the service user), as on a hosted box.
// RAZZLE_LLM=api|cli forces one; RAZZLE_CLAUDE_BIN names the CLI (default `claude` on PATH).

import Anthropic from '@anthropic-ai/sdk'
import { spawn, spawnSync } from 'node:child_process'

export const MODELS = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-5',
  opus: 'claude-opus-5-5',
}

let client: Anthropic | null = null
export function claude(): Anthropic {
  if (!client) client = new Anthropic({ maxRetries: 1 })
  return client
}

const CLAUDE_BIN = process.env.RAZZLE_CLAUDE_BIN ?? 'claude'
const hasApiKey = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)
let cliFound: boolean | null = null
const hasCli = () => (cliFound ??= spawnSync(CLAUDE_BIN, ['--version'], { stdio: 'ignore', timeout: 10_000 }).status === 0)

export function claudeBackend(): 'api' | 'cli' | null {
  const forced = process.env.RAZZLE_LLM
  if (forced === 'api') return hasApiKey() ? 'api' : null
  if (forced === 'cli') return hasCli() ? 'cli' : null
  return hasApiKey() ? 'api' : hasCli() ? 'cli' : null
}

export function hasClaude(): boolean {
  return claudeBackend() !== null
}

/** First balanced JSON object or array in `text`. */
export function extractJSON(text: string): unknown {
  const t = text.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '')
  const start = t.search(/[[{]/)
  if (start < 0) throw new Error('no JSON in response')
  const open = t[start], close = open === '{' ? '}' : ']'
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < t.length; i++) {
    const c = t[i]
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue }
    if (c === '"') inStr = true
    else if (c === open) depth++
    else if (c === close && --depth === 0) return JSON.parse(t.slice(start, i + 1))
  }
  throw new Error('unterminated JSON in response')
}

export interface JSONCall {
  model: string
  system: string
  user: string
  maxTokens?: number
  schema?: Record<string, unknown> // JSON schema for structured output (additionalProperties:false everywhere)
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  signal?: AbortSignal
  stream?: boolean // for long outputs
}

function textOf(msg: Anthropic.Message): string {
  if (msg.stop_reason === 'refusal') throw new Error('model refused')
  return msg.content.map(b => (b.type === 'text' ? b.text : '')).join('')
}

/** One Claude call that returns parsed JSON. Uses structured output when a schema is given,
 *  falling back to prompt-only JSON if the model rejects the format. */
export async function claudeJSON<T = unknown>(c: JSONCall): Promise<T> {
  if (claudeBackend() === 'cli') return claudeCliJSON<T>(c)
  const base = {
    model: c.model,
    max_tokens: c.maxTokens ?? 2048,
    system: c.system,
    messages: [{ role: 'user' as const, content: c.user }],
  }
  const withCfg = (fmt: boolean) => {
    const output_config: Record<string, unknown> = {}
    if (fmt && c.schema) output_config.format = { type: 'json_schema', schema: c.schema }
    if (c.effort) output_config.effort = c.effort
    return Object.keys(output_config).length ? { ...base, output_config } : base
  }
  const send = async (fmt: boolean): Promise<Anthropic.Message> => {
    const body = withCfg(fmt) as Anthropic.MessageCreateParamsNonStreaming
    if (c.stream) return claude().messages.stream(body, { signal: c.signal }).finalMessage()
    return claude().messages.create(body, { signal: c.signal })
  }
  let msg: Anthropic.Message
  try {
    msg = await send(true)
  } catch (e) {
    if (c.schema && e instanceof Anthropic.BadRequestError) msg = await send(false)
    else throw e
  }
  return extractJSON(textOf(msg)) as T
}

/** The same call through `claude -p`: no tools, no session saved, structured output when a
 *  schema is given (that takes a second turn), parsed from the CLI's JSON result. */
function claudeCliJSON<T>(c: JSONCall): Promise<T> {
  const args = ['-p', '--model', c.model, '--output-format', 'json', '--max-turns', '3', '--tools', '',
    '--no-session-persistence', '--strict-mcp-config', '--system-prompt', c.system]
  if (c.schema) args.push('--json-schema', JSON.stringify(c.schema))
  if (c.effort) args.push('--effort', c.effort)
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY // the CLI would prefer it to the logged-in account
  delete env.CLAUDECODE
  return new Promise<T>((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { err += d })
    const abort = () => { child.kill('SIGTERM'); reject(new Error('aborted')) }
    c.signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('claude -p timed out')) }, 600_000)
    child.on('error', e => { clearTimeout(timer); reject(e) })
    child.on('close', code => {
      clearTimeout(timer)
      c.signal?.removeEventListener('abort', abort)
      try {
        const r = JSON.parse(out) as { is_error?: boolean, result?: string, structured_output?: unknown }
        if (r.is_error) throw new Error(`claude -p: ${String(r.result ?? '').slice(0, 300)}`)
        resolve((r.structured_output ?? extractJSON(r.result ?? '')) as T)
      } catch (e) {
        reject(code === 0 ? e : new Error(`claude -p exited ${code}: ${(err || out).slice(0, 300)}`))
      }
    })
    child.stdin.end(c.user)
  })
}

// ---------- Jev (typesafe.ai systemone) ----------

export type JevQuestion =
  | { type: 'noul', instructions: string, criteria?: string }
  | { type: 'choice', instructions: string, criteria: string[] | Record<string, string> }
  | { type: 'score', instructions: string, criteria?: string }

export type JevAnswer =
  | { type: 'noul', noul: unknown }
  | { type: 'choice', choice: string, probabilities?: Record<string, number>, confidence?: number }
  | { type: 'score', score?: number, [k: string]: unknown }

const jevKey = () => process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY
export function hasJev(): boolean { return Boolean(jevKey()) }

export async function jev(state: unknown, questions: Record<string, JevQuestion>, signal?: AbortSignal):
  Promise<Record<string, JevAnswer>> {
  const r = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${jevKey()}` },
    body: JSON.stringify({ state, model: 'jev-latest', questions }),
    signal,
  })
  if (!r.ok) throw new Error(`jev HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const j = await r.json() as { answers?: Record<string, JevAnswer> }
  if (!j.answers) throw new Error('jev: no answers')
  return j.answers
}

/** Interpret a `noul` answer as a yes/no. */
export function noulYes(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v >= 0.5
  if (typeof v === 'string') return /^\s*(yes|true|y|covered)\b/i.test(v)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    for (const k of ['answer', 'value', 'yes', 'result']) if (k in o) return noulYes(o[k])
  }
  return false
}
