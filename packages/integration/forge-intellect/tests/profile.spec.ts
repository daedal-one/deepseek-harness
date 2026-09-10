import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { runSchema } from '../src/plan.ts'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const fixture = fileURLToPath(new URL('./fixtures/profile.cordis.yml', import.meta.url))
const native = spawnSync('forge-intellect', ['--version'], { encoding: 'utf8' }).status === 0 && spawnSync('spec', ['--version'], { encoding: 'utf8' }).status === 0
async function prepare(cwd: string, broken = false) {
  await mkdir(join(cwd, '.specs'), { recursive: true })
  await writeFile(join(cwd, '.gitignore'), '.dsh/\n.agents/\n')
  await writeFile(join(cwd, '.specs/_config.toml'), 'baseline = "forge-spec-v0.7.0"\nproject = "PROJECT:fixture"\nintellect_provider = "forge-intellect"\n')
  await writeFile(join(cwd, '.specs/_project.spec.md'), '---\nid: PROJECT:fixture\ntype: project\nowners: [fixture]\nstatus: accepted\nsummary: Verification fixture\n---\n# Fixture\nA small deterministic implementation check.\n')
  await writeFile(join(cwd, '.specs/value.spec.md'), '---\nid: REQ:test/nonnegative\ntype: requirement\nowners: [fixture]\nstatus: accepted\nlevel: MUST\nsummary: Return the nonnegative magnitude of a finite number\n---\n# Nonnegative magnitude\n:::{requirement id="value" level="MUST"}\n- {#c-value} For every finite input, return its nonnegative magnitude.\n:::\n[Implementation](spec:src:value.mjs)\n[Checks](spec:src:verify.mjs)\n')
  await writeFile(join(cwd, 'value.mjs'), `export const magnitude = n => ${broken ? '-' : ''}Math.abs(n);\n`)
  await writeFile(join(cwd, 'verify.mjs'), "import { strict as assert } from 'node:assert';\nimport { magnitude } from './value.mjs';\nfor (const n of [-3, 0, 2.5]) assert.equal(magnitude(n), Math.abs(n));\nassert.equal(process.env.OPENROUTER_API_KEY, undefined);\nassert.equal(process.env.INTELLECT_TEST_SECRET, undefined);\nconsole.log('NONNEGATIVE_ASSERTIONS_PASSED');\n")
  const git = (args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } })
  const lint = spawnSync('spec', ['lint'], { cwd, encoding: 'utf8' })
  if (lint.status !== 0) throw new Error(lint.stdout + lint.stderr)
  git(['init', '-b', 'main']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']); git(['add', '.']); git(['commit', '-m', 'Fixture implementation\n\nSpec-Ref: REQ:test/nonnegative (implements)'])
}

describe.skipIf(!native || process.platform === 'win32')('Deadal-intellect shipped profile with real native verification', () => {
  it.each(['supported', 'contradicted', 'reject', 'cancel', 'tampered-plan', 'dirty-approval', 'reassess', 'corrected-protocol', 'invalid-protocol'] as const)('retains honest evidence for %s', async (mode) => {
    const refused = ['reject', 'tampered-plan', 'dirty-approval'].includes(mode)
    let inspected = false
    const result = await runLoaderSmoke({
      label: `intellect ${mode}`, tempDirPrefix: 'dsh-intellect-profile-',
      binScript: join(root, 'apps/cli/src/bin.ts'), configPath: fixture,
      binArgs: ['--profile', 'deadal-intellect-headless', '--patch', fixture, 'Verify the fixture requirement.'],
      tsconfigPath: join(root, 'tsconfig.json'), processTimeoutMs: 210000,
      env: { INTELLECT_TEST_MODE: mode, INTELLECT_TEST_SECRET: 'must-not-reach-checks', DSH_TELEMETRY_DISABLED: '1' },
      prepare: cwd => prepare(cwd, mode === 'contradicted'),
      inspect: async (cwd) => {
        const areas = await readdir(join(cwd, '.git/verification-fixture')).catch(() => [])
        if (!areas.length) return
        const area = join(cwd, '.git/verification-fixture', areas[0]!)
        const records = await readdir(join(area, 'records')).catch(() => [])
        inspected = true
        if (refused) { expect(records).toHaveLength(0); return }
        expect(records).toHaveLength(mode === 'reassess' ? 2 : 1)
        const retained = await Promise.all(records.map(async file => runSchema.parse(JSON.parse(
          await readFile(join(area, 'records', file), 'utf8'),
        ))))
        const record = retained.find(r => !r.source)!
        if (mode === 'reassess') {
          const reassessment = retained.find(r => r.source === record.id)!
          expect(reassessment.state, reassessment.error).toBe('completed')
          expect(reassessment.plan).not.toBe(record.plan)
          const sourcePolicy = await readFile(join(area, 'plans', record.plan, 'policy.json'), 'utf8')
          expect(await readFile(join(area, 'plans', reassessment.plan, 'policy.json'), 'utf8')).toBe(sourcePolicy)
          const status = JSON.parse(execFileSync('forge-intellect', [
            'verify', 'status', join(area, 'runs', reassessment.id), cwd,
            join(area, 'plans', reassessment.plan, 'policy.json'),
          ], { encoding: 'utf8' })) as { execution_freshness: string; freshness: string }
          expect(status.execution_freshness).toBe('current')
          expect(status.freshness).toBe('current')
        }
        if (mode === 'invalid-protocol') {
          expect(record.state).toBe('failed')
          expect(record.error).toContain('reviewer returned an invalid response after 3 attempts')
          return
        }
        if (mode === 'cancel') { expect(record.state).toBe('cancelled'); return }
        expect(record.state, record.error).toBe('completed')
        const run = join(area, 'runs', record.id)
        const report = z.object({ decisions: z.array(z.object({ assessment: z.string() })) }).parse(JSON.parse(
          execFileSync('forge-intellect', ['verify', 'inspect', run], { encoding: 'utf8' }),
        ))
        expect(report.decisions.length).toBeGreaterThan(0)
        expect(report.decisions.every((d: { assessment: string }) => d.assessment === 'supported')).toBe(['supported', 'reassess', 'corrected-protocol'].includes(mode))
        const identity = z.object({ session_id: z.string() })
        const nativeRun = z.object({
          checks: z.array(z.object({ outcome: z.string() })),
          configuration: z.object({ planning_agents: z.record(z.string(), identity) }),
          agents: z.array(z.object({ identity })),
        }).parse(JSON.parse(await readFile(join(run, 'run.json'), 'utf8')))
        expect(nativeRun.checks[0]!.outcome).toBe(['supported', 'reassess', 'corrected-protocol'].includes(mode) ? 'passed' : 'failed')
        const identities = [...Object.values(nativeRun.configuration.planning_agents), ...nativeRun.agents.map(a => a.identity)]
        expect(new Set(identities.map(i => i.session_id)).size).toBe(4)
        for (const role of ['assessor', 'challenger']) for (const stage of ['plan', 'review']) {
          const events = JSON.parse(await readFile(join(run, 'agents', role, stage, 'session-events.json'), 'utf8')) as { type: string }[]
          expect(events.some(e => e.type === 'session/title-llm-request')).toBe(false)
          if (mode === 'corrected-protocol') {
            const response = JSON.parse(await readFile(join(run, 'agents', role, stage, 'response.json'), 'utf8')) as {
              identity: { protocol_corrections: string[] }
              response: { stage?: string }
            }
            expect(response.identity.protocol_corrections).toHaveLength(1)
            expect(response.response.stage).toBeUndefined()
          }
        }
      },
    })
    expect(result.stdout).not.toContain('INTELLECT_PREPARE_FAILED')
    expect(result.stdout).not.toContain('INTELLECT_REASSESS_FAILED')
    expect(result.stdout).toContain(refused ? 'INTELLECT_RUN_REJECTED' : 'INTELLECT_FIXTURE_FINISHED')
    expect(inspected).toBe(true)
    if (['supported', 'reassess', 'corrected-protocol'].includes(mode)) expect(result.stdout).not.toContain('native-refusal')
    if (mode === 'contradicted' || mode === 'invalid-protocol') expect(result.stdout).toContain('native-refusal')
    if (mode === 'tampered-plan') expect(result.stdout).toContain('policy changed')
    if (mode === 'dirty-approval') expect(result.stdout).toContain('changed during approval')
  }, 225000)
})
