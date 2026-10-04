import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { dump, load } from 'js-yaml'
import { fingerprintSessionPrefix, type SessionAdmission } from '@deepseek-ai/dsh-agent-presets'
import { deriveReplayScript, parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { SessionId, SessionLogOffset, type SessionHeader } from '@deepseek-ai/dsh-session'
import { parseSystemPromptSnapshot, parseToolSchemasSnapshot, sessionFixtureFiles } from '@deepseek-ai/dsh-session-snapshot'
import { generationLogPath } from '../../../../../../packages/session/session-persistence-jsonl/src/format.ts'

const repoRoot = fileURLToPath(new URL('../../../../../../', import.meta.url))
const fixtureRoot = fileURLToPath(new URL('.', import.meta.url))

export type AdmissionControl = 'resume' | 'bad-digest' | 'unlisted' | 'cancel'

export async function runHostAdmission(scenarioDir: string, control: AdmissionControl) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-host-admission-'))
  try {
    const root = await realpath(temporaryRoot)
    const cwd = join(root, 'workspace')
    const home = join(root, 'home')
    await mkdir(cwd)
    await mkdir(home)
    const fixtures = sessionFixtureFiles(await readdir(scenarioDir))
    assert.equal(fixtures.length, 1)
    const selected = fixtures[0]!
    const expected = await readFile(join(scenarioDir, selected.name), 'utf8')
    const prompt = parseSystemPromptSnapshot(await readFile(join(scenarioDir, 'system-prompt.expected.md'), 'utf8')).initial
    const schemas = parseToolSchemasSnapshot(await readFile(join(scenarioDir, 'tool-schemas.expected.json'), 'utf8')).initial
    const hydrated = expected.replaceAll('{{cwd}}', cwd.replaceAll('\\', '\\\\'))
      .replaceAll('{{session:1}}', 'synthetic-original-host')
      .replaceAll('"{{system}}"', JSON.stringify(prompt.trimEnd()))
      .replaceAll('"{{tools}}"', JSON.stringify(schemas))
    const events = parseSessionLog(hydrated)
    const prefixCount = events.findIndex(event => event.type === 'turn/end') + 1
    assert(prefixCount > 0)
    const { type: _type, ...header } = JSON.parse(hydrated.split('\n')[0]!) as SessionHeader & { type: string }
    const originalEvents = events.slice(0, prefixCount)
    const source = { header, events: originalEvents, inheritedEventCount: SessionLogOffset(0) }
    const admission: SessionAdmission = {
      sessionId: header.id,
      agentPreset: header.agentPreset!,
      cwd,
      createdAt: header.createdAt,
      parentSession: null,
      origin: null,
      delegationDepth: header.delegationDepth ?? null,
      isSeeded: false,
      inheritedEventCount: SessionLogOffset(0),
      prefix: fingerprintSessionPrefix(source, prefixCount),
      compositionPreset: 'host-wrapper',
    }
    const original = [JSON.stringify({ type: 'session', ...header }), ...originalEvents.map(event => JSON.stringify(event))].join('\n') + '\n'
    const persisted = generationLogPath(join(home, 'sessions'), cwd, header.id, header.version, 'none')
    await mkdir(dirname(persisted), { recursive: true })
    await writeFile(persisted, original, { flag: 'wx', mode: 0o600 })
    const suffix = events.slice(prefixCount)
    const continuation = suffix.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
    assert(continuation?.type === 'user/message')
    const task = continuation.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    assert(task.length > 0)
    const script = deriveReplayScript(suffix)
    assert.equal(script.length, 1)
    const replayPath = join(root, 'continuation.replay.json')
    await writeFile(replayPath, JSON.stringify(control === 'cancel' ? [{ kind: 'hang' }] : script))
    const replayFixture = join(root, selected.name)
    await writeFile(replayFixture, expected)
    const rows = load(await readFile(join(fixtureRoot, 'logical.cordis.yml'), 'utf8')) as object[]
    const presets = join(root, 'presets')
    for (const [id, composition, permission] of [
      ['legacy-host', rows, 'read-only'],
      ['host-wrapper', [{
        id: 'host-execution', name: 'cordis:group', group: true,
        isolate: { fs: true, subprocess: true, shell: true },
        config: [
          { id: 'host-fs', name: '@deepseek-ai/dsh-fs-sandbox' },
          { id: 'host-subprocess', name: '@deepseek-ai/dsh-subprocess-local' },
          { id: 'host-shell', name: '@deepseek-ai/dsh-bash-sandbox' },
          ...rows,
        ],
      }], 'danger-full-access'],
    ] as const) {
      await mkdir(join(presets, id), { recursive: true })
      await writeFile(join(presets, id, 'agent.cordis.yml'), dump(composition))
      await writeFile(join(presets, id, 'access.yml'), `permissionPreset: ${permission}\n`)
    }
    const output = join(root, 'evidence.json')
    const probe = join(home, 'profiles', 'host-admission-probe.ts')
    await mkdir(dirname(probe), { recursive: true })
    await writeFile(probe, await readFile(join(fixtureRoot, 'probe.ts'), 'utf8'))
    const patch = join(root, 'snapshot.patch.yml')
    const configuredAdmission = control === 'bad-digest'
      ? { ...admission, prefix: { ...admission.prefix, sha256: '0'.repeat(64) } }
      : control === 'unlisted' ? { ...admission, sessionId: SessionId('another-admitted-host') } : admission
    await writeFile(patch, dump([
      ...['llm-deepseek', 'llm-pi-ai', 'session-title-llm', 'session-activity-summary', 'session-summary', 'session-telemetry-otel', 'openrouter-spend'].map(id => ({ id, disabled: true })),
      { id: 'agent-default-model', config: { provider: 'snapshot', model: 'replay' } },
      { id: 'settings', config: { path: join(home, 'settings.yaml'), watch: false } },
      { id: 'session-persistence-jsonl', config: { root: join(home, 'sessions'), compression: 'none' } },
      { id: 'agent-presets', config: { default: 'legacy-host', includeUserRoot: false, roots: [{ path: presets, trust: 'system' }], sessionAdmissions: [configuredAdmission] } },
      { insert: [{ id: 'host-admission-probe', name: probe, config: { fixture: replayFixture, replay: replayPath, output, sessionId: header.id, task, control } }] },
    ], { lineWidth: -1 }))
    const launch = resolveExampleLaunch({
      srcBin: join(repoRoot, 'apps/cli/src/bin.ts'),
      tsconfigPath: join(repoRoot, 'tsconfig.json'),
      sourceImport: 'tsx/esm',
      configArgs: ['--profile', 'web', '--patch', patch, '--no-open', '--port', '0'],
    })
    const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
      /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TMP|TEMP|TMPDIR|LANG|LC_ALL)$/iu.test(name)))
    const result = await execa(launch.command, launch.args, {
      cwd,
      extendEnv: false,
      env: { ...environment, ...launch.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home, DSH_HOME: home, DSH_AGENTS_HOME: join(root, 'agents'), DSH_TELEMETRY_DISABLED: '1', NODE_NO_WARNINGS: '1' },
      input: '',
      timeout: 90_000,
      killSignal: 'SIGTERM',
      forceKillAfterDelay: 10_000,
      reject: false,
    })
    assert.equal(result.timedOut, false, result.stderr)
    assert.equal(result.signal, undefined, result.stderr)
    assert.equal(result.exitCode, 0, `${result.stdout}\n${result.stderr}`.replace(/([?&]token=)[^\s]+/gu, '$1<test-token>'))
    const actual = await readFile(persisted, 'utf8')
    assert(actual.startsWith(original), 'the imported header and complete original prefix must remain byte-identical')
    if (control === 'bad-digest' || control === 'unlisted') {
      const appended = parseSessionLog(actual).slice(prefixCount)
      assert.deepEqual(appended.map(({ type, data }) => ({ type, data })), [{ type: 'session/end-seed', data: {} }])
    }
    assert.deepEqual((await readdir(dirname(persisted))).filter(name => name.endsWith('.jsonl')), [basename(persisted)])
    const evidence = JSON.parse(await readFile(output, 'utf8')) as {
      port: number
      refused?: string
      logicalPreset?: string
      compositionPreset?: string
      realConsumer?: string
      isolatedHost?: boolean
      canceled?: boolean
      requests?: number
      request?: { system: unknown[]; tools: unknown[] }
    }
    return { actual, expected, cwd, root, evidence, original, sessionId: String(header.id), prefixCount }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}
