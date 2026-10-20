// Sign-in for a hosted server (the private studio). Off unless RAZZLE_HTPASSWD names an
// htpasswd file of bcrypt entries ("user:$2y$...").
//
// Processes on the same box (the director service) instead send "Authorization: Bearer <token>"
// with the token from RAZZLE_INTERNAL_TOKEN.
//
// The login page (login.html) posts to api/auth/login, which sets a signed session cookie
// ("user.expiry.hmac", HttpOnly, Secure). Every other request needs that cookie: pages are
// redirected to the login page, API calls and WebSocket upgrades get 401.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type http from 'node:http'
import bcrypt from 'bcryptjs'

const COOKIE = 'razzle_session'
const TTL_S = 30 * 24 * 3600
const LOGIN_PAGE = fs.readFileSync(path.join(import.meta.dirname, 'login.html'), 'utf8')

export interface Auth {
  /** Handles the login routes; for anything else returns true when the request may proceed. */
  gate(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<boolean>
  /** Whether a WebSocket upgrade request carries a valid session. */
  allowUpgrade(req: http.IncomingMessage): boolean
}

export function createAuth(opts: { htpasswd: string, secretFile: string, cookiePath: string, internalToken?: string }): Auth {
  const secret = loadSecret(opts.secretFile)
  const sign = (s: string) => crypto.createHmac('sha256', secret).update(s).digest('base64url')
  const attempts = new Map<string, number[]>()

  const users = (): Map<string, string> => {
    const m = new Map<string, string>()
    for (const line of fs.readFileSync(opts.htpasswd, 'utf8').split('\n')) {
      const i = line.indexOf(':')
      if (i > 0) m.set(line.slice(0, i).trim(), line.slice(i + 1).trim())
    }
    return m
  }

  const session = (req: http.IncomingMessage): string | null => {
    const raw = (req.headers.cookie ?? '').split(';').map(c => c.trim()).find(c => c.startsWith(COOKIE + '='))
    if (!raw) return null
    // "user.expiry.mac", read from the right: user names may contain dots
    const parts = decodeURIComponent(raw.slice(COOKIE.length + 1)).split('.')
    const mac = parts.pop(), exp = parts.pop(), user = parts.join('.')
    if (!user || !exp || !mac) return null
    const want = sign(`${user}.${exp}`)
    if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null
    return Number(exp) * 1000 > Date.now() ? user : null
  }

  const internal = (req: http.IncomingMessage): boolean => {
    const h = String(req.headers.authorization ?? '')
    if (!opts.internalToken || !h.startsWith('Bearer ')) return false
    const got = Buffer.from(h.slice(7)), want = Buffer.from(opts.internalToken)
    return got.length === want.length && crypto.timingSafeEqual(got, want)
  }

  const cookie = (value: string, maxAge: number) =>
    `${COOKIE}=${encodeURIComponent(value)}; Path=${opts.cookiePath}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`

  // at most 10 sign-in attempts per address per minute
  const throttled = (req: http.IncomingMessage) => {
    const ip = String(req.headers['x-real-ip'] ?? req.socket.remoteAddress ?? '')
    const now = Date.now()
    const recent = (attempts.get(ip) ?? []).filter(t => now - t < 60_000)
    recent.push(now)
    attempts.set(ip, recent)
    return recent.length > 10
  }

  const send = (res: http.ServerResponse, code: number, type: string, body: string, headers: Record<string, string> = {}) => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...headers })
    res.end(body)
  }

  return {
    async gate(req, res, pathname) {
      if (pathname === '/login' && req.method === 'GET') {
        send(res, 200, 'text/html; charset=utf-8', LOGIN_PAGE)
        return false
      }
      if (pathname === '/api/auth/login' && req.method === 'POST') {
        if (throttled(req)) { send(res, 429, 'application/json', JSON.stringify({ error: 'Too many attempts; wait a minute.' })); return false }
        let body: { username?: string, password?: string } = {}
        try {
          const chunks: Buffer[] = []
          for await (const c of req) chunks.push(c as Buffer)
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch { /* empty body */ }
        const hash = users().get(String(body.username ?? ''))
        const ok = !!hash && await bcrypt.compare(String(body.password ?? ''), hash.replace(/^\$2y\$/, '$2b$'))
        if (!ok) { send(res, 401, 'application/json', JSON.stringify({ error: 'Incorrect username or password.' })); return false }
        const exp = Math.floor(Date.now() / 1000) + TTL_S
        const value = `${body.username}.${exp}`
        send(res, 200, 'application/json', JSON.stringify({ ok: true }), { 'set-cookie': cookie(`${value}.${sign(value)}`, TTL_S) })
        return false
      }
      if (pathname === '/api/auth/logout') {
        send(res, 200, 'application/json', JSON.stringify({ ok: true }), { 'set-cookie': cookie('', 0) })
        return false
      }
      if (session(req) || internal(req)) return true
      if (pathname.startsWith('/api/') || req.method !== 'GET') send(res, 401, 'application/json', JSON.stringify({ error: 'sign in first' }))
      else {
        // relative to the page, so it works under whatever prefix nginx mounts us at
        const depth = pathname.split('/').length - 2
        send(res, 302, 'text/plain', 'sign in first', { location: `${'../'.repeat(Math.max(0, depth)) || './'}login` })
      }
      return false
    },
    allowUpgrade(req) {
      return session(req) !== null || internal(req)
    },
  }
}

function loadSecret(file: string): Buffer {
  try {
    return fs.readFileSync(file)
  } catch {
    const s = crypto.randomBytes(32)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, s, { mode: 0o600 })
    return s
  }
}
