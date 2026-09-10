import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { openBridge } from '../src/bridge.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const packet = { schema: 'forge-intellect-verification-agent/v1', role: 'assessor', stage: 'plan', context: { obligations: [], sources: {} }, response_contract: {} }
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'intellect-bridge-'))
  roots.push(root)
  const directory = join(root, 'agents/assessor/plan')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'request.json'), JSON.stringify(packet))
  return { root, directory }
}
function client(socket: string, directory: string, input: object) {
  const process = spawn(globalThis.process.execPath, [fileURLToPath(new URL('../runtime/bridge.mjs', import.meta.url)), socket], { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'] })
  const done = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    let stdout = '', stderr = ''
    process.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8') })
    process.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8') })
    process.once('error', reject)
    process.once('close', (code) =>{  resolve({ code, stdout, stderr }) })
  })
  process.stdin.end(JSON.stringify(input))
  return { process, done }
}
describe('private native reviewer transport', () => {
  it('transfers only the retained native packet, rejects duplicate and forged calls, and removes its socket', async () => {
    const { root, directory } = await fixture()
    const broker = await openBridge(root, new AbortController().signal, async received => ({ schema: received.schema, fixture: 'reviewed' }))
    try {
      const forged = client(broker.path, directory, { ...packet, role: 'challenger' })
      expect((await forged.done).code).not.toBe(0)
      const result = await client(broker.path, directory, packet).done
      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ fixture: 'reviewed' })
      expect((await client(broker.path, directory, packet).done).code).not.toBe(0)
    } finally { await broker.close() }
    await expect(readFile(broker.path)).rejects.toMatchObject({ code: 'ENOENT' })
  }, 15000)
  it('cancels and awaits the active reviewer when its transport goes away', async () => {
    const { root, directory } = await fixture()
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    let stopped = false
    const broker = await openBridge(root, new AbortController().signal, async (_packet, _directory, signal) => {
      started()
      await new Promise<void>((resolve) =>{  signal.addEventListener('abort', () => { stopped = true; resolve() }, { once: true }) })
      throw new Error('cancelled')
    })
    const running = client(broker.path, directory, packet)
    try {
      await ready
      running.process.kill()
      await running.done
      await broker.close()
      expect(stopped).toBe(true)
    } finally { running.process.kill() }
  }, 15000)
})
