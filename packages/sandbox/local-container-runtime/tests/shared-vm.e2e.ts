import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import LocalContainerFileSystem from '@deepseek-ai/dsh-fs-local-container'
import LocalContainerSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local-container'
import SharedVmRuntime, { sharedVmId, type SharedVmConfig } from '../src/shared-vm.ts'
import { IncusDevelopmentVms } from '../src/vm-engine.ts'
import * as startup from '../src/startup.ts'

const configuration = process.env.DSH_SHARED_VM_CONFIG
const gitConfigured = configuration !== undefined
  && (SharedVmRuntime.Config(JSON.parse(configuration) as SharedVmConfig).gitRemotes?.length ?? 0) > 0

describe.skipIf(configuration === undefined)('persistent shared Incus execution', { retry: 0 }, () => {
  it.skipIf(!gitConfigured)('authenticates configured HTTPS and SSH remotes without credentials in controllers', async () => {
    if (configuration === undefined) throw new Error('shared VM configuration is required')
    const config = SharedVmRuntime.Config(JSON.parse(configuration) as SharedVmConfig)
    const ctx = new Context()
    try {
      await ctx.plugin(SharedVmRuntime, config)
      await ctx.executionRuntime.ensureReady()
      const controller = await ctx.executionRuntime.executeController({
        argv: ['/usr/bin/python3', '-c', 'import os; assert not any(k.startswith("GIT_CONFIG_") for k in os.environ)'],
        stdin: Buffer.alloc(0), maxOutputBytes: 4096, deadlineMs: 10000,
      })
      expect(controller.exitCode).toBe(0)
      for (const remote of config.gitRemotes ?? []) {
        const url = new URL(remote.url)
        const aliases = url.port === '' ? [remote.url, `git@${url.host}:${url.pathname.slice(1)}`, `ssh://git@${url.host}${url.pathname}`] : [remote.url]
        for (const alias of aliases) {
          const handle = await ctx.executionRuntime.createProcess({
            argv: ['/usr/bin/git', 'ls-remote', '--exit-code', alias, 'HEAD'],
            cwd: '/workspace', environment: { GIT_TERMINAL_PROMPT: '0' }, tty: false, stdin: false,
            signal: AbortSignal.timeout(30000),
          })
          try {
            handle.stream.resume()
            expect((await handle.done).exitCode).toBe(0)
          } finally { await handle.terminate(); expect(await handle.waitForRemoval()).toBe(true) }
        }
      }
    } finally { await ctx.fiber.dispose() }
  })

  it('shares files and retains the VM across provider disposal and reattachment', async () => {
    if (configuration === undefined) throw new Error('shared VM configuration is required')
    const config = SharedVmRuntime.Config(JSON.parse(configuration) as SharedVmConfig)
    const directory = await mkdtemp(join(config.workspaceDirectory, 'harness-probe-'))
    const contexts: Context[] = []
    const mount = async () => {
      const ctx = new Context(); contexts.push(ctx)
      await ctx.plugin(SharedVmRuntime, config)
      await ctx.plugin(LocalContainerFileSystem, {
        cwdAliases: [], maxFileBytes: 4096, diffBasisMaxBytes: 1024,
        maxControllerOutputBytes: 16384, operationTimeoutMs: 10000,
      })
      await ctx.plugin(LocalContainerSubprocessRuntime, { cwdAliases: [], controlOutputBytes: 8192, controlTimeoutMs: 10000 })
      await ctx.plugin(startup)
      await ctx.executionRuntime.ensureReady()
      return ctx
    }
    try {
      const first = await mount(); const second = await mount()
      expect(first.executionRuntime.containerName).toBe(second.executionRuntime.containerName)
      const path = join(directory, 'shared.txt')
      await writeFile(path, 'host-visible\n')
      const target = await first.fs.resolve(path)
      expect(await first.fs.readText(target)).toBe('host-visible\n')
      const guestDirectory = first.executionRuntime.executionPath(directory)
      const result = await first.executionRuntime.executeController({
        argv: ['/bin/sh', '-ceu', 'printf "guest-visible\\n" > "$1/shared.txt"', 'probe', guestDirectory],
        stdin: Buffer.alloc(0), maxOutputBytes: 4096, deadlineMs: 10000,
      })
      expect(result.exitCode).toBe(0)
      expect(await second.fs.readText(await second.fs.resolve(path))).toBe('guest-visible\n')
      expect(await readFile(path, 'utf8')).toBe('guest-visible\n')
      for (const repository of config.repositories) {
        expect(second.subprocess.resolveWorkingDirectory(repository.source)).toBe(repository.path)
        expect(second.fs.processPath(await second.fs.resolve(repository.source))).toBe(repository.path)
      }
      const left = await first.executionRuntime.createProcess({
        argv: ['/bin/sleep', '300'], cwd: '/workspace', environment: {}, tty: false, stdin: false,
      })
      const right = await second.executionRuntime.createProcess({
        argv: ['/bin/sleep', '300'], cwd: '/workspace', environment: {}, tty: false, stdin: false,
      })
      const active = async (unit: string) => await second.executionRuntime.executeController({
        argv: ['systemctl', 'is-active', unit], stdin: Buffer.alloc(0), maxOutputBytes: 4096, deadlineMs: 10000,
      })
      try {
        await expect.poll(async () => (await active(left.id)).stdout.toString().trim()).toBe('active')
        await expect.poll(async () => (await active(right.id)).stdout.toString().trim()).toBe('active')
        await left.terminate()
        expect(await left.waitForRemoval()).toBe(true)
        expect((await active(right.id)).stdout.toString().trim()).toBe('active')
      } finally {
        await Promise.all([left.terminate(), right.terminate()])
      }
      await first.fiber.dispose(); await second.fiber.dispose()
      const reopened = await mount()
      expect(await reopened.fs.readText(await reopened.fs.resolve(path))).toBe('guest-visible\n')
      expect(await new IncusDevelopmentVms(config).exists(sharedVmId(config.environmentId))).toBe(true)
    } finally {
      await Promise.all(contexts.map(ctx => ctx.fiber.dispose()))
      await rm(directory, { recursive: true, force: true })
    }
  })
})
