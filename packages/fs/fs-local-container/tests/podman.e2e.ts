import { Context } from '@deepseek-ai/cordis'
import { FsVersion } from '@deepseek-ai/dsh-fs'
import LocalContainerFileSystem from '@deepseek-ai/dsh-fs-local-container'
import LocalContainerRuntime from '@deepseek-ai/dsh-local-container-runtime'
import { describe, expect, it } from 'vitest'

const socketPath = process.env.DSH_PODMAN_SOCKET
const image = process.env.DSH_PODMAN_IMAGE
const enabled = socketPath !== undefined && socketPath !== '' && image !== undefined && image !== ''

const runtimeConfig = {
  manageService: false,
  serviceStartupTimeoutMs: 10_000,
  user: 'dsh',
  environment: {
    DSH_OPERATION_ID: 'container-filesystem-e2e',
    HOME: '/home/dsh',
    LANG: 'C.UTF-8',
    PATH: '/usr/local/bin:/usr/bin:/bin',
  },
  memoryBytes: 268_435_456,
  nanoCpus: 500_000_000,
  pidsLimit: 128,
  tmpfsBytes: 67_108_864,
  engineRequestTimeoutMs: 10_000,
  maxLiveProcesses: 4,
  lifetimeMs: 60_000,
  stopTimeoutSeconds: 5,
}

describe.skipIf(!enabled)('rootless Podman container filesystem', () => {
  it('shares atomic UTF-8 file state with bounded controller commands without host path disclosure', async () => {
    if (socketPath === undefined || image === undefined) throw new Error('Podman integration environment disappeared before setup')
    const ctx = new Context()
    const runtimeFiber = await ctx.plugin(LocalContainerRuntime, { socketPath, image, ...runtimeConfig })
    const filesystemFiber = await ctx.plugin(LocalContainerFileSystem, {
      cwdAliases: ['/host/session-workspace'],
      maxFileBytes: 1024,
      diffBasisMaxBytes: 512,
      maxControllerOutputBytes: 8192,
      operationTimeoutMs: 10_000,
    })
    try {
      const fs = ctx.fs as LocalContainerFileSystem
      const file = await fs.resolve('unicode.txt', { cwd: '/host/session-workspace' })
      const content = 'é\n'
      const created = await fs.writeText(file, content, { kind: 'createIfAbsent' })
      expect(created.operation).toBe('create')
      expect(file.displayPath).toBe('/workspace/unicode.txt')
      expect(String(file.targetKey)).toBe('/workspace/unicode.txt')
      expect(await fs.readText(file)).toBe(content)
      await expect(fs.readBytes(file, undefined, 3).then(Array.from)).resolves.toEqual([0xc3, 0xa9, 0x0a])
      await expect(fs.readBytes(file, undefined, 2)).rejects.toMatchObject({ code: 'FS_TOO_LARGE' })

      const bridge = await ctx.localContainerRuntime.executeController({
        argv: ['/bin/sh', '-c', 'cat /workspace/unicode.txt'],
        stdin: new Uint8Array(),
        maxOutputBytes: 1024,
        deadlineMs: 10_000,
      })
      expect(bridge).toMatchObject({ exitCode: 0 })
      expect(new TextDecoder('utf-8', { fatal: true }).decode(bridge.stdout)).toBe(content)

      await ctx.localContainerRuntime.executeController({
        argv: ['/bin/sh', '-c', 'ln -s unicode.txt /workspace/link.txt && ln -s /etc/passwd /workspace/outside.txt'],
        stdin: new Uint8Array(),
        maxOutputBytes: 1024,
        deadlineMs: 10_000,
      })
      expect((await fs.resolve('link.txt')).targetKey).toBe(file.targetKey)
      await expect(fs.resolve('outside.txt')).rejects.toMatchObject({ code: 'FS_PERMISSION_DENIED' })

      const version = (await fs.stat(file))?.version
      if (version === undefined) throw new Error('container file disappeared before guarded edits')
      const first = fs.editText(file, { oldString: 'é', newString: 'ê', replaceAll: false }, { version })
      const second = fs.editText(file, { oldString: 'é', newString: 'ë', replaceAll: false }, { version: FsVersion(version) })
      const outcomes = await Promise.allSettled([first, second])
      expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
      expect(outcomes.filter(outcome => outcome.status === 'rejected')).toMatchObject([{ reason: { code: 'FS_STALE_VERSION' } }])
    } finally {
      await filesystemFiber.dispose()
      await runtimeFiber.dispose()
    }
  })
})
