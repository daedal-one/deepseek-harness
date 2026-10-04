/** Real dsh profile publication and restart; only its external LLM provider is scripted. */
import { mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ArtifactRevision } from '@deepseek-ai/dsh-artifact/types'
const repo = fileURLToPath(new URL('../../../../', import.meta.url))
const patch = fileURLToPath(new URL('./fixtures/composition.patch.yml', import.meta.url))
async function logs(cwd: string): Promise<string[]> {
  const root = join(cwd, '.dsh', 'sessions')
  const files = (await readdir(root, { recursive: true }))
    .filter(file => file.endsWith('session.v3.jsonl'))
    .sort()
  return Promise.all(files.map(file => readFile(join(root, file), 'utf8')))
}
it('captures immutable revisions through the normal tools and reopens inactive publications after process restart', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-artifact-composition-'))
  await symlink(
    join(repo, 'node_modules'),
    join(cwd, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  const run = async (restart: boolean) => {
    const launch = resolveExampleLaunch({
      srcBin: join(repo, 'apps/cli/src/bin.ts'),
      configArgs: [
        '--profile',
        'headless',
        '--patch',
        patch,
        restart ? 'Read artifacts after restart.' : 'Create, update and restore an artifact.',
      ],
      tsconfigPath: join(repo, 'tsconfig.json'),
      sourceImport: 'tsx/esm',
      env: {
        DSH_HOME: join(cwd, '.dsh'),
        DSH_AGENTS_HOME: join(cwd, '.agents'),
        DEEPSEEK_API_KEY: '',
        DSH_ARTIFACT_FIXTURE_RESTART: restart ? '1' : '',
      },
    })
    return execa(launch.command, launch.args, {
      cwd,
      env: launch.env,
      input: '',
      timeout: 30000,
      killSignal: 'SIGKILL',
      stripFinalNewline: false,
    })
  }
  try {
    const first = await run(false)
    expect(first.stdout).toBe('ARTIFACT_COMPOSITION_OK\n')
    const [original] = await logs(cwd)
    expect(original).toBeDefined()
    const records = original!
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as SessionEvent)
    const revisions = records
      .filter(event => event.type === 'artifact/published')
      .map(event => event.data.revision)
    expect(revisions).toHaveLength(3)
    expect(revisions[1]!.parent).toBe(revisions[0]!.revisionId)
    expect(revisions[2]!.restoredFrom).toBe(revisions[0]!.revisionId)
    expect(revisions[2]!.parent).toBe(revisions[1]!.revisionId)
    expect(new Set(revisions.map(revision => revision.workspaceId)).size).toBe(1)
    expect(revisions[2]!.assets).toEqual(revisions[0]!.assets)
    const events = records.filter(event => event.type === 'tool/result')
    expect(events[0]).toMatchObject({ data: { message: { content: [{ isError: true }] } } })
    expect(events[4]).toMatchObject({ data: { message: { content: [{ isError: true }] } } })
    expect(events[1]!.data.message.content).toEqual(
      events[2]!.data.message.content.map(value => ({
        ...value,
        toolCallId: 'artifact-fixture-1',
      })),
    )
    const second = await run(true)
    expect(second.stdout).toBe('ARTIFACT_RESTART_OK\n')
    const after = await logs(cwd)
    expect(after).toHaveLength(2)
    expect(after).toContain(original)
    const cold = after.find(log => log !== original)!
    const coldRecords = cold
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as SessionEvent)
    expect(coldRecords.some(event => event.type === 'artifact/published')).toBe(false)
    const result = coldRecords.filter(event => event.type === 'tool/result').at(-1)
    const block = result!.data.message.content.find(value => value.type === 'tool-result')!
    const text = block.content.find(value => value.type === 'text')!
    const value = JSON.parse(text.text) as { content: string; revision: ArtifactRevision }
    expect(value.content).toBe('<h1>Original durable report</h1>')
    expect(value.revision).toEqual(revisions[2])
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}, 75000)
