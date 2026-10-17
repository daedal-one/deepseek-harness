import { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import FileSystem from '@deepseek-ai/dsh-fs-local-container'
import Subprocess from '@deepseek-ai/dsh-subprocess-local-container'
import SharedVmRuntime, { sharedVmId, type SharedVmConfig } from '../src/shared-vm.ts'
import { IncusDevelopmentVms, incusCommand } from '../src/vm-engine.ts'
import type { LocalContainerProcessHandle, LocalContainerProcessRequest } from '../src/types.ts'
import * as startup from '../src/startup.ts'

const filename = process.env.DSH_SHARED_VM_CAPACITY_CONFIG

// This qualification stops its VM. Its exact configuration must name a disposable qualification environment.
describe.skipIf(filename === undefined)('shared VM directory and execution capacity', { retry: 0 }, () => {
  it('uses real providers across excess selections, queued commands and an independent VM restart', async () => {
    if (filename === undefined) throw new Error('Capacity qualification configuration is required')
    const input = JSON.parse(await readFile(filename, 'utf8')) as { runtime: SharedVmConfig; selectionRoot: string }
    const config = SharedVmRuntime.Config(input.runtime)
    if (!/^qualification-[a-z0-9-]+$/u.test(config.environmentId) || config.directoryExports === undefined
      || config.maxLiveProcesses !== 2) throw new Error('Capacity qualification requires a disposable namespace-export VM and two command slots')
    const ctx = new Context(); const handles: LocalContainerProcessHandle[] = []
    const engine = new IncusDevelopmentVms(config); const id = sharedVmId(config.environmentId)
    const native = incusCommand(config)
    const guest = async (...argv: string[]) => await native(['exec', engine.name(id), '--project', config.project, '--', ...argv])
    try {
      await ctx.plugin(SharedVmRuntime, config)
      await ctx.plugin(FileSystem, { cwdAliases: [], maxFileBytes: 4096, diffBasisMaxBytes: 1024,
        maxControllerOutputBytes: 16384, operationTimeoutMs: 30000 })
      await ctx.plugin(Subprocess, { cwdAliases: [], controlOutputBytes: 8192, controlTimeoutMs: 30000 })
      await ctx.plugin(startup); await ctx.executionRuntime.ensureReady()
      const initialBoot = Buffer.from(await guest('cat', '/proc/sys/kernel/random/boot_id')).toString()
      const sources = await Promise.all(Array.from({ length: 12 }, async () => await mkdtemp(join(input.selectionRoot, 'selected-'))))
      await Promise.all(sources.map(async (source) => { await ctx.serial('workspace/prepare', source, 'workspace') }))
      const aliases = sources.map(source => ctx.executionRuntime.executionPath(source))
      for (const [index, source] of sources.entries()) {
        const file = await ctx.fs.resolve(join(source, 'roundtrip.txt'))
        await ctx.fs.writeText(file, `workspace ${index}\n`)
        expect(await ctx.fs.readText(file)).toBe(`workspace ${index}\n`)
        expect(await readFile(join(source, 'roundtrip.txt'), 'utf8')).toBe(`workspace ${index}\n`)
        expect((await ctx.fs.listDir(await ctx.fs.resolve(source))).map(entry => entry.name)).toContain('roundtrip.txt')
        expect(ctx.subprocess.resolveWorkingDirectory(source)).toBe(aliases[index])
      }
      const cwd = ctx.executionRuntime.executionPath(sources[0]!) as LocalContainerProcessRequest['cwd']
      const run = async (argv: [string, ...string[]], signal?: AbortSignal) => {
        const handle = await ctx.executionRuntime.createProcess({ argv, cwd, environment: {}, tty: false, stdin: false,
          ...signal === undefined ? {} : { signal } })
        handles.push(handle); handle.stream.resume(); return handle
      }
      const first = await run(['/bin/sleep', '300']); const second = await run(['/bin/sleep', '300'])
      const cancel = new AbortController()
      const cancelled = run(['/bin/true'], cancel.signal)
      const rejected = expect(cancelled).rejects.toThrow('withdrawn')
      await ctx.executionRuntime.ensureReady(); cancel.abort(new Error('withdrawn')); await rejected
      expect(Buffer.from(await guest('systemctl', 'is-active', second.id)).toString().trim()).toBe('active')
      const queued = run(['/bin/sh', '-ceu', 'printf "queued command\\n" > queued.txt'])
      await ctx.executionRuntime.ensureReady()
      await first.terminate(); expect(await first.waitForRemoval()).toBe(true)
      const admitted = await queued; expect((await admitted.done).exitCode).toBe(0)
      expect(await readFile(join(sources[0]!, 'queued.txt'), 'utf8')).toBe('queued command\n')
      const extra = await mkdtemp(join(input.selectionRoot, 'extra-'))
      await ctx.serial('workspace/prepare', extra, 'workspace')
      await engine.verify(id, config.workspaceDirectory, config.repositories)
      expect(Buffer.from(await guest('cat', '/proc/sys/kernel/random/boot_id')).toString()).toBe(initialBoot)
      expect(Buffer.from(await guest('systemctl', 'is-active', second.id)).toString().trim()).toBe('active')
      await second.terminate(); expect(await second.waitForRemoval()).toBe(true)
      await engine.stop(id); await engine.start(id)
      // The original Harness object remains alive; its next tool restores the new worker namespace.
      for (const [index, source] of sources.entries()) {
        expect(await ctx.fs.readText(await ctx.fs.resolve(join(source, 'roundtrip.txt')))).toBe(`workspace ${index}\n`)
        expect(ctx.executionRuntime.executionPath(source)).toBe(aliases[index])
      }
      await mkdir(join(extra, 'retained'), { recursive: true })
      expect((await ctx.fs.listDir(await ctx.fs.resolve(extra))).map(entry => entry.name)).toContain('retained')
    } finally {
      await Promise.allSettled(handles.map(async (handle) => { await handle.terminate() }))
      await ctx.fiber.dispose()
    }
    // Selected sources and root-owned records remain retained for recovery inspection.
  })
})
