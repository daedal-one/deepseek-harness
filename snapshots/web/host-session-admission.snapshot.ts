import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  formatSystemPromptSnapshot,
  formatToolSchemasSnapshot,
  normalizeSessionSnapshot,
  normalizeSessionSnapshots,
  parseSnapshotManifest,
  redactSessionSnapshotIds,
  sessionFixtureName,
} from '@deepseek-ai/dsh-session-snapshot'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { runHostAdmission } from '../../apps/cli/tests/profiles/web/host-session-admission/harness.ts'

const directory = fileURLToPath(new URL('./host-session-admission/', import.meta.url))
const mode = process.env.DSH_SNAPSHOT ?? 'replay'
if (!['replay', 'refresh', 'record'].includes(mode)) throw new Error(`Unknown snapshot mode: ${mode}`)

// runHostAdmission requires the owned child's unsignaled, untimed-out exit, then reads
// its flushed Session before removing the fixture root; released ports have no owner.
describe.skipIf(process.platform === 'win32' || mode === 'record')('host-session-admission CLI Web snapshot', () => {
  const scenario = mode === 'replay' ? it.concurrent : it
  scenario('resumes the admitted original Session and pins its ordinary logical request', async () => {
    const manifest = parseSnapshotManifest(await readFile(join(directory, 'snapshot.yml'), 'utf8'))
    expect(manifest).toMatchObject({ profile: 'web', recording: 'authored', header: { pin: true } })
    const result = await runHostAdmission(directory, 'resume')
    expect(result.evidence).toMatchObject({
      logicalPreset: 'legacy-host', compositionPreset: 'host-wrapper',
      realConsumer: '@deepseek-ai/dsh-tool-bash', isolatedHost: true, canceled: false, requests: 2,
    })
    const context = { cwd: result.cwd, sessionIds: [result.sessionId] }
    const request = result.evidence.request!
    const system = (request.system as Array<Array<{ type: string; text?: string }>>)
      .flat().filter(block => block.type === 'text').map(block => block.text).join('\n')
    const prompt = formatSystemPromptSnapshot(system)
    const tools = formatToolSchemasSnapshot(request.tools)
    const writtenFixture = join(directory, sessionFixtureName(0, SESSION_FORMAT_VERSION))
    if (mode === 'refresh') {
      await writeFile(writtenFixture, normalizeSessionSnapshot(redactSessionSnapshotIds([result.actual])[0]!, { ...context, sessionIds: [] }, { identityMode: 'preserve' }))
      await writeFile(join(directory, 'system-prompt.expected.md'), prompt)
      await writeFile(join(directory, 'tool-schemas.expected.json'), tools)
    }
    const expected = mode === 'refresh' ? await readFile(writtenFixture, 'utf8') : result.expected
    expect(normalizeSessionSnapshots([result.actual], context))
      .toEqual(normalizeSessionSnapshots([expected], { cwd: '{{cwd}}', sessionIds: ['{{session:1}}'] }))
    expect(prompt).toBe(await readFile(join(directory, 'system-prompt.expected.md'), 'utf8'))
    expect(tools).toBe(await readFile(join(directory, 'tool-schemas.expected.json'), 'utf8'))
    expect(existsSync(result.root)).toBe(false)
  })

  scenario.each(['bad-digest', 'unlisted'] as const)('refuses %s before publishing or accepting continuation work', async (control) => {
    const result = await runHostAdmission(directory, control)
    expect(result.evidence.refused).toBe(control)
    expect(result.actual.startsWith(result.original)).toBe(true)
    expect(existsSync(result.root)).toBe(false)
  })

  scenario('cancels an entered replay stream and flushes the aborted turn before exit', async () => {
    const result = await runHostAdmission(directory, 'cancel')
    expect(result.evidence).toMatchObject({ canceled: true, requests: 1 })
    const rows = result.actual.trimEnd().split('\n').map(line => JSON.parse(line) as { type: string; data?: unknown })
    expect(rows.findLast(row => row.type === 'turn/end')).toMatchObject({ data: { reason: { kind: 'aborted' } } })
    expect(rows.filter(row => row.type === 'assistant/message')).toHaveLength(1)
    expect(existsSync(result.root)).toBe(false)
  })
})
