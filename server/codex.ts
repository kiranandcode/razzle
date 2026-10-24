import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

export async function codexJSON(prompt: string, schema: object): Promise<unknown> {
  const dir = await mkdtemp(path.join(tmpdir(), 'razzle-notes-'))
  try {
    const schemaFile = path.join(dir, 'schema.json')
    const output = path.join(dir, 'notes.json')
    await writeFile(schemaFile, JSON.stringify(schema))
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.env.RAZZLE_CODEX_BIN ?? 'codex', ['exec', '--ignore-user-config', '--ephemeral',
        '--sandbox', 'read-only', '--skip-git-repo-check', '--cd', dir, '--output-schema', schemaFile,
        '--output-last-message', output, '-'], { stdio: ['pipe', 'ignore', 'pipe'] })
      let err = ''
      child.stderr.on('data', d => { err = (err + d).slice(-2000) })
      child.stdin.on('error', () => {})
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Codex notes timed out; the recording is saved. Retry Notes.')) }, 600_000)
      child.on('error', e => { clearTimeout(timer); reject(new Error(`Could not start Codex: ${e.message}`)) })
      child.on('close', code => {
        clearTimeout(timer)
        if (code === 0) resolve()
        else reject(new Error(`Codex exited ${code}: ${err.slice(-500)}`))
      })
      child.stdin.end(prompt)
    })
    return JSON.parse(await readFile(output, 'utf8'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
