import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LocalContainerFileSystem from '@deepseek-ai/dsh-fs-local-container'
import * as startup from '@deepseek-ai/dsh-local-container-runtime/startup'
import LocalContainerSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local-container'
import { afterEach, describe, expect, it, vi } from 'vitest'

class FakeRuntime extends Service {
  readonly executionWorld = Object.freeze({})
  readonly workspacePath = '/workspace' as const
  readonly getContainer = vi.fn(async () => ({ id: 'fake', workspacePath: this.workspacePath }))
  readonly executeController = vi.fn()

  constructor(ctx: Context) {
    super(ctx, 'localContainerRuntime')
  }
}

let root: string | undefined
let context: Context | undefined
afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('local-container execution world Loader composition', () => {
  it('publishes one verified identity only after both providers mount', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-local-container-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-local-container-runtime'",
      "- name: '@deepseek-ai/dsh-fs-local-container'",
      '  config:',
      '    cwdAliases: [/host/workspace]',
      '    maxFileBytes: 1024',
      '    diffBasisMaxBytes: 512',
      '    maxControllerOutputBytes: 4096',
      '    operationTimeoutMs: 1000',
      "- name: '@deepseek-ai/dsh-subprocess-local-container'",
      '  config:',
      '    cwdAliases: [/host/workspace]',
      '    controlOutputBytes: 4096',
      '    controlTimeoutMs: 1000',
      "- name: '@deepseek-ai/dsh-local-container-runtime/startup'",
      '',
    ].join('\n'))

    const ctx = new Context()
    context = ctx
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-local-container-runtime', FakeRuntime],
      ['@deepseek-ai/dsh-fs-local-container', LocalContainerFileSystem],
      ['@deepseek-ai/dsh-subprocess-local-container', LocalContainerSubprocessRuntime],
      ['@deepseek-ai/dsh-local-container-runtime/startup', startup],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        const plugin = modules.get(specifier)
        if (plugin === undefined) throw new Error(`unexpected Loader import: ${specifier}`)
        return plugin
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()

    const marker = ctx.get('localContainerExecutionWorld')
    expect(marker !== undefined).toBe(true)
    expect(ctx.fs.executionWorld === marker).toBe(true)
    expect(ctx.subprocess.executionWorld === marker).toBe(true)
    expect(ctx.subprocess.resolveWorkingDirectory('/host/workspace')).toBe('/workspace')
    expect((ctx.get('localContainerRuntime') as unknown as FakeRuntime).getContainer).toHaveBeenCalledOnce()
  })
})
