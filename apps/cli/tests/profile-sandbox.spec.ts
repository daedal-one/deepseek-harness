/** Host-maintenance policy composition over shipped profile layers. */

import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox'
import { SandboxProvider, type ConfinedArgv } from '@deepseek-ai/dsh-sandbox'
import SandboxPolicyService, { type Config as PolicyConfig, setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { describe, expect, it } from 'vitest'
import { profileSandboxPatches } from '../src/profile-sandbox.ts'

const base = fileURLToPath(new URL('../../../packages/bundle/base/cordis.patch.yml', import.meta.url))

function authored(extra: PatchOptions[] = []): PatchOptions[] {
  return [...loadOverlayPatches('test', base), ...extra]
}

function configured(extra: PatchOptions[] = []) {
  const patches = authored(extra)
  return composeEntries([patches, profileSandboxPatches(false, patches)])
}

describe('profile sandbox setting', () => {
  it.each([undefined, true])('preserves authored policy when sandbox is %s', (sandbox) => {
    expect(profileSandboxPatches(sandbox, authored())).toEqual([])
  })

  it('applies host defaults after overlays without changing unrelated options or source layers', () => {
    const patches = authored([
      { id: 'sandbox-policy', config: { mode: 'read-only', workspaceRoot: '/project' } },
      { id: 'approval', config: { policy: 'ask', timeoutMs: 4321 } },
    ])
    const before = structuredClone(patches)
    const entries = composeEntries([patches, profileSandboxPatches(false, patches)])
    expect(entries.find(row => row.id === 'sandbox-policy')?.config).toEqual({ mode: 'danger-full-access', workspaceRoot: '/project' })
    expect(entries.find(row => row.id === 'approval')?.config).toEqual({ policy: 'never', timeoutMs: 4321 })
    expect(entries.find(row => row.id === 'permission')?.config).toMatchObject({
      defaultPreset: 'danger-full-access',
      presets: { 'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' } },
    })
    expect(patches).toEqual(before)
  })

  it.each(['subprocess', 'fs-sandbox', 'sandbox-policy', 'approval', 'permission'])('rejects a disabled %s row before boot', (id) => {
    expect(() => configured([{ id, disabled: true }])).toThrow('launch a separate host profile')
  })

  it('rejects replacement execution providers instead of claiming container escape', () => {
    const entries = composeEntries([authored()])
    const subprocess = entries.find(row => row.id === 'subprocess')!
    subprocess.name = '@deepseek-ai/dsh-subprocess-local-container'
    expect(() => profileSandboxPatches(false, [{ insert: entries }]))
      .toThrow('requires the enabled host row subprocess')
  })

  it('preserves an omitted policy config and rejects opaque whole-config expressions', () => {
    const rows = configured([{ id: 'sandbox-policy', config: {} }, { id: 'permission', config: {} }])
    expect(rows.find(row => row.id === 'sandbox-policy')?.config).toEqual({ mode: 'danger-full-access' })
    expect(() => configured([{ id: 'approval', config: 'invalid' }])).toThrow('requires object configurations')
  })

  it.skipIf(process.platform === 'win32')('writes and runs on the host without invoking a sandbox runner, retaining explicit session restrictions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-host-profile-'))
    const ctx = new Context()
    try {
      const workspace = join(root, 'workspace')
      const outside = join(root, 'host.txt')
      await mkdir(workspace)
      const policy = configured([{ id: 'sandbox-policy', config: { mode: 'read-only', workspaceRoot: workspace } }])
        .find(row => row.id === 'sandbox-policy')?.config as PolicyConfig
      class UnavailableSandbox extends SandboxProvider {
        confine(): ConfinedArgv { throw new Error('the host profile must not invoke a sandbox runner') }
      }
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(SandboxPolicyService, policy)
      await ctx.plugin(UnavailableSandbox)
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(SandboxedFileSystem, { cwd: workspace })
      await ctx.plugin(SandboxBashExecutor, { cwd: workspace, timeoutMs: 5000 })
      await ctx.fs.writeText(await ctx.fs.resolve(outside), 'host maintenance')
      expect(await readFile(outside, 'utf8')).toBe('host maintenance')
      const result = await ctx.shell.run(ctx.shell.resolve({ command: 'cat ../host.txt' }))
      expect(result).toMatchObject({ exitCode: 0, timedOut: false, aborted: false, stdout: { text: 'host maintenance' } })
      const id = SessionId('host-policy')
      const session = Session.create(id, undefined, { id, version: SESSION_FORMAT_VERSION, createdAt: 0, isSeeded: false, cwd: workspace })
      setSandboxMode(session, 'read-only')
      await expect(ctx.fs.writeText(await ctx.fs.resolve(outside), 'denied', undefined, undefined, ctx.sandboxPolicy.resolve({ session })))
        .rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
      expect(await readFile(outside, 'utf8')).toBe('host maintenance')
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
