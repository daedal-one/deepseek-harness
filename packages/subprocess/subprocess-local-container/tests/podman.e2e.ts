import { Context } from '@deepseek-ai/cordis'
import LocalContainerFileSystem from '@deepseek-ai/dsh-fs-local-container'
import LocalContainerRuntime from '@deepseek-ai/dsh-local-container-runtime'
import LocalContainerSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local-container'
import { describe, expect, it } from 'vitest'

const socketPath = process.env.DSH_PODMAN_SOCKET
const image = process.env.DSH_PODMAN_IMAGE
const enabled = socketPath !== undefined && socketPath !== '' && image !== undefined && image !== ''

describe.skipIf(!enabled)('rootless Podman container subprocess provider', () => {
  it('shares files, bounded spill output, and a real terminal with the filesystem provider', async () => {
    if (socketPath === undefined || image === undefined) throw new Error('Podman integration environment disappeared before setup')
    const ctx = new Context()
    const runtimeFiber = await ctx.plugin(LocalContainerRuntime, {
      socketPath,
      manageService: false,
      serviceStartupTimeoutMs: 10_000,
      image,
      user: 'dsh',
      environment: { HOME: '/home/dsh', LANG: 'C.UTF-8', PATH: '/usr/local/bin:/usr/bin:/bin' },
      memoryBytes: 268_435_456,
      nanoCpus: 500_000_000,
      pidsLimit: 128,
      tmpfsBytes: 67_108_864,
      engineRequestTimeoutMs: 10_000,
      maxLiveProcesses: 4,
      lifetimeMs: 60_000,
      stopTimeoutSeconds: 2,
    })
    const fsFiber = await ctx.plugin(LocalContainerFileSystem, {
      cwdAliases: ['/host/workspace'],
      maxFileBytes: 4096,
      diffBasisMaxBytes: 2048,
      maxControllerOutputBytes: 16_000,
      operationTimeoutMs: 10_000,
    })
    const subprocessFiber = await ctx.plugin(LocalContainerSubprocessRuntime, {
      cwdAliases: ['/host/workspace'],
      controlOutputBytes: 4096,
      controlTimeoutMs: 10_000,
    })
    try {
      expect(ctx.fs.executionWorld === ctx.subprocess.executionWorld).toBe(true)
      const handle = ctx.subprocess.spawn({
        argv: ['/bin/sh', '-c', 'printf shared >/workspace/shared.txt; printf 123456'],
        cwd: '/host/workspace',
        stdio: { stdin: 'ignore', stdout: { maxBytes: 3, spill: { maxBytes: 64 } }, stderr: { maxBytes: 64 } },
        graceMs: 1000,
      })
      await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
      const collected = handle.collected.stdout?.readFrom(0)
      expect(collected).toMatchObject({ text: '456', lossy: true, spillPath: expect.stringMatching(/^\/workspace\//u) as unknown })
      const shared = await ctx.fs.resolve('shared.txt', { cwd: '/host/workspace' })
      await expect(ctx.fs.readText(shared)).resolves.toBe('shared')
      if (collected?.spillPath === undefined) throw new Error('bounded output did not publish its spill')
      const spill = await ctx.fs.resolve(collected.spillPath)
      await expect(ctx.fs.readText(spill)).resolves.toBe('123456')

      const terminal = await ctx.subprocess.spawnTerminal({
        argv: ['/bin/cat'],
        cwd: '/host/workspace',
        env: { TERM: 'xterm-256color' },
        rows: 24,
        cols: 80,
        graceMs: 1000,
      })
      const output = readUntil(terminal.output, 'terminal-line')
      await terminal.write('terminal-line\n')
      await expect(output).resolves.toContain('terminal-line')
      await expect(terminal.inspectForeground()).resolves.toMatchObject({
        processGroupId: expect.any(Number) as unknown, inputWaiting: true,
      })
      await expect(terminal.signalForeground('SIGTERM')).resolves.toEqual(expect.any(Number))
      await terminal.terminate()
    } finally {
      await subprocessFiber.dispose()
      await fsFiber.dispose()
      await runtimeFiber.dispose()
    }
  }, 30_000)
})

async function readUntil(stream: NodeJS.ReadableStream, expected: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    let value = ''
    const data = (chunk: Uint8Array): void => {
      value += Buffer.from(chunk).toString('utf8')
      if (value.includes(expected)) {
        cleanup()
        resolve(value)
      }
    }
    const ended = (): void => { cleanup(); resolve(value) }
    const failed = (error: Error): void => { cleanup(); reject(error) }
    const cleanup = (): void => {
      stream.off('data', data)
      stream.off('end', ended)
      stream.off('error', failed)
    }
    stream.on('data', data)
    stream.once('end', ended)
    stream.once('error', failed)
  })
}
