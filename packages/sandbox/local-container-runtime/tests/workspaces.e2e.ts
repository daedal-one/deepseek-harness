import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash, randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import * as Instructions from '@deepseek-ai/dsh-agent-instructions'
import * as FsTools from '@deepseek-ai/dsh-tool-fs'
import ContainerFs from '@deepseek-ai/dsh-fs-local-container'
import ContainerSubprocess from '@deepseek-ai/dsh-subprocess-local-container'
import Runtime from '../src/index.ts'
import Workspaces from '../src/workspaces.ts'
import DevelopmentVms from '../src/vm.ts'
import { workspaceGit } from '../src/workspace-git.ts'
import { previewProbe, terminalProbe } from './vm/probes.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { describe, expect, it } from 'vitest'

const socketPath = process.env.DSH_PODMAN_SOCKET
const image = process.env.DSH_PODMAN_IMAGE
const rawPool = process.env.DSH_WORKSPACE_POOL
const rawVm = process.env.DSH_DEVELOPMENT_VM
const vmConfig: unknown = rawVm === undefined ? undefined : JSON.parse(rawVm)
const enabled = process.platform === 'linux' && socketPath !== undefined && image !== undefined && rawPool !== undefined
const limits = { gitCommand: '/usr/bin/git', authorName: 'DSH', authorEmail: 'dsh@localhost', resourceLimitCommand: '/usr/bin/prlimit', gitMemoryBytes: 512 * 1024 * 1024, maxBytes: 4 * 1024 * 1024, maxEntries: 1000, timeoutMs: 30_000 }

describe.skipIf(!enabled)('conversation workspace real Podman Loader flow', () => {
  it('isolates two conversations, commits residual agent writes, returns branches, and resumes the saved repository', async () => {
    if (socketPath === undefined || image === undefined || rawPool === undefined) throw new Error('workspace test environment disappeared')
    const poolPaths = JSON.parse(rawPool) as string[]
    const root = await mkdtemp(join(tmpdir(), 'dsh-workspaces-e2e-'))
    const source = join(root, 'source'); await mkdir(source)
    if (vmConfig !== undefined) await cp(new URL('./vm/app/', import.meta.url), join(source, 'app'), { recursive: true })
    await workspaceGit(source, ['init', '--template=', '--initial-branch=main'], limits)
    await writeFile(join(source, 'input.txt'), 'original\n'); await writeFile(join(source, '.gitignore'), 'ignored\n')
    await workspaceGit(source, ['add', '.'], limits); await workspaceGit(source, ['commit', '-m', 'initial'], limits)
    await writeFile(join(source, 'input.txt'), 'user edits\n'); await writeFile(join(source, 'untracked.txt'), 'user input\n'); await writeFile(join(source, 'ignored'), 'host secret\n')
    await writeFile(join(source, 'AGENTS.md'), 'WORKSPACE_IMPORTED_INSTRUCTIONS: Keep changes focused.\n')
    const originalIndex = await readFile(join(source, '.git/index')); const originalHead = await workspaceGit(source, ['rev-parse', 'HEAD'], limits)
    const ids = [SessionId(`workspace-e2e-${randomUUID()}`), SessionId(`workspace-e2e-${randomUUID()}`)] as const
    const workspaceIds = ids.map(id => createHash('sha256').update(id).digest('hex').slice(0, 32))
    const ctx = new Context()
    let first: Awaited<ReturnType<typeof ctx.agents.create>> | undefined
    let second: Awaited<ReturnType<typeof ctx.agents.create>> | undefined
    try {
      const modules = new Map<string, unknown>([
        ['sessions', SessionStore], ['projections', SessionProjectionRegistry], ['persistence', Persistence], ['llm', LlmRuntime], ['agents', AgentRegistry],
        ['system-prompt', SystemPrompt], ['tools', Tools], ['loop', AgentLoop], ['container', Runtime], ['container-fs', ContainerFs], ['container-subprocess', ContainerSubprocess], ['workspaces', Workspaces], ['development-vms', DevelopmentVms], ['instructions', Instructions], ['fs-tools', FsTools],
      ])
      const entries = [
        { name: 'sessions' }, { name: 'projections' }, { name: 'persistence', config: { root: join(root, 'sessions'), compression: 'none' } },
        { name: 'llm' }, { name: 'agents' }, { name: 'system-prompt' }, { name: 'tools' },
        { name: 'container', config: { socketPath, manageService: false, serviceStartupTimeoutMs: 10000, image, user: 'dsh', environment: { HOME: '/home/dsh', LANG: 'C.UTF-8', PATH: '/usr/local/bin:/usr/bin:/bin' }, memoryBytes: 268435456, nanoCpus: 500000000, pidsLimit: 128, tmpfsBytes: 67108864, engineRequestTimeoutMs: 10000, maxLiveProcesses: 8, lifetimeMs: vmConfig === undefined ? 300000 : 900000, stopTimeoutSeconds: 2 } },
        { name: 'container-fs', config: { cwdAliases: [], maxFileBytes: 65536, diffBasisMaxBytes: 32768, maxControllerOutputBytes: 200000, operationTimeoutMs: 10000 } },
        { name: 'container-subprocess', config: { cwdAliases: [], controlOutputBytes: 4096, controlTimeoutMs: 10000 } },
        ...vmConfig === undefined ? [] : [{ name: 'development-vms', config: vmConfig }],
        { name: 'workspaces', config: { ...limits, poolPaths, slotBytes: 67108864, slotInodes: 20000, recoveryRoot: join(root, 'recovery'), maxOutputBytes: 8388608, settleTimeoutMs: 10000, retryDelayMs: 1000, messageProvider: 'mock', messageModel: 'cheap', messageInputBytes: 4096, messageOutputTokens: 64, messageTimeoutMs: 10000 } },
        { name: 'instructions', config: { dshHome: '/workspace/.dsh', maxBytes: 4096 } },
        { name: 'fs-tools' }, { name: 'loop', config: { agents: [] } },
      ]
      const configPath = join(root, 'cordis.yml'); await writeFile(configPath, JSON.stringify(entries))
      ctx.baseUrl = pathToFileURL(root).href + '/'; await ctx.plugin(Loader); ctx.loader.builtins.include = Include
      ctx.loader.internal = { version: 'v2', async import(specifier: string) { const module = modules.get(specifier); if (module === undefined) throw new Error(`unexpected test module ${specifier}`); return module } } as unknown as NonNullable<typeof ctx.loader.internal>
      await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } }); await ctx.loader.await()
      const adapter = new MockAdapter([toolCallResponse('workspace-write', 'write', { file_path: 'result.txt', content: 'agent result\n' }), textResponse('Done.'), textResponse('feat: add result'), textResponse('No further changes.'), textResponse('Background work remains active.'), ...vmConfig === undefined ? [textResponse('chore: retain background output')] : [], 'hang'])
      ctx.llm.registerAdapter(['mock'], adapter)
      const id = ids[0]
      first = await ctx.agents.create({ sessionId: id, meta: { cwd: source }, agentOptions: { provider: 'mock', model: 'main' } })
      second = await ctx.agents.create({ sessionId: ids[1], meta: { cwd: source }, agentOptions: { provider: 'mock', model: 'main' } })
      const diagnose = (agent: Agent): void => {
        if (vmConfig !== undefined) {
          const runtime = ctx.agents.withInitiator(agent, () => ctx.conversationWorkspaces.capture())
          const execute = runtime.executeController.bind(runtime)
          runtime.executeController = async (request) => {
            const result = await execute(request)
            if (result.exitCode !== 0 || result.stdout.length === 0) console.error('VM acceptance controller failure', {
              exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString(),
            })
            return result
          }
        }
      }
      diagnose(first.agent); diagnose(second.agent)
      const read = async (agent: Agent, path: string) => ctx.agents.withInitiator(
        agent, async () => ctx.fs.readText(await ctx.fs.resolve(path, { cwd: source })),
      )
      console.info('Workspace acceptance: imported source')
      expect(await read(first.agent, 'input.txt')).toBe('user edits\n')
      expect(await read(first.agent, 'untracked.txt')).toBe('user input\n')
      await expect(read(first.agent, 'ignored')).rejects.toThrow()
      const command = async (agent: Agent, code: string) => ctx.agents.withInitiator(agent, async () => {
        const process = ctx.subprocess.spawn({ argv: ['/bin/sh', '-c', code], cwd: source,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } }, graceMs: 1000 })
        const result = await process.done
        if (result.exitCode !== 0) throw new Error(process.collected.stderr?.readFrom(0).text ?? 'container command failed')
        return process.collected.stdout?.readFrom(0).text
      })
      if (vmConfig !== undefined) {
        expect(await command(first.agent, `test ! -e '${source}' && test ! -S /var/lib/incus/unix.socket && printf host-paths-absent`)).toBe('host-paths-absent')
        expect(await command(first.agent, 'cd app && { docker compose up -d --build --wait >/tmp/compose.log 2>&1 || { tail -30 /tmp/compose.log >&2; exit 1; }; } && cp browser.mjs /opt/dsh-browser/check.mjs && cd /opt/dsh-browser && node --version && wc -c check.mjs && node check.mjs')).toContain('vm-browser-ok')
        const runtime = ctx.agents.withInitiator(first.agent, () => ctx.conversationWorkspaces.capture())
        console.info('VM acceptance: Compose and Chromium ready')
        await previewProbe(runtime)
        console.info('VM acceptance: authenticated HTTP and WebSocket preview passed')
        await terminalProbe(runtime)
        console.info('VM acceptance: terminal passed')
        await command(second.agent, 'systemd-run --quiet --collect --unit=dsh-isolation python3 -m http.server 80 --bind 0.0.0.0 && curl --retry 10 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:80 >/dev/null')
        const peer = (await command(second.agent, 'hostname -I'))?.trim().split(' ')[0]
        if (peer === undefined || !/^\d+\.\d+\.\d+\.\d+$/u.test(peer)) throw new Error('missing guest IPv4 address')
        expect(await command(first.agent, `if curl --connect-timeout 2 --max-time 3 -fsS http://${peer}:80 >/dev/null 2>&1; then exit 1; fi; printf peer-denied`)).toBe('peer-denied')
        expect(await command(first.agent, `docker run --rm --privileged --pid=host -v /:/guest $(docker compose -f app/compose.yaml images -q app) sh -c 'test -f /guest/etc/os-release && test ! -e "/guest${source}" && test ! -S /guest/var/lib/incus/unix.socket && test ! -S "/guest${socketPath}" && printf guest-only'`)).toBe('guest-only')
      }
      console.info('Workspace acceptance: compiling and saving')
      expect(await command(first.agent, "printf 'int main(void) { return 0; }\\n' >probe.c && printf 'probe\\n' >>.gitignore && cc probe.c -o probe && ./probe && git add probe.c && git commit -m 'feat: add probe' && printf 'compiled-and-committed'"))
        .toContain('compiled-and-committed')
      expect(await command(first.agent, 'if dd if=/dev/zero of=quota-probe bs=1048576 count=80 >/dev/null 2>&1; then exit 2; fi; rm quota-probe; printf quota-enforced')).toBe('quota-enforced')
      await writeFile(join(source, 'input.txt'), 'concurrent host edit\n')
      first.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Write result.txt.' }], source: { kind: 'user' } }))
      await first.agent.whenIdle()
      const receipt = first.agent.session.snapshotEvents().findLast(event => event.type === 'workspace/state')
      expect(receipt?.data).toMatchObject({ phase: 'returned', turn: 1 })
      expect(JSON.stringify(adapter.requests[0]?.messages)).toContain('WORKSPACE_IMPORTED_INSTRUCTIONS')
      expect(JSON.stringify(adapter.requests[0]?.messages)).not.toContain(source)
      expect(await read(first.agent, 'result.txt')).toBe('agent result\n')
      if (vmConfig !== undefined) expect(await command(first.agent, 'curl -fsS http://127.0.0.1:8080')).toContain('id="counter">1</p>')
      await expect(read(second.agent, 'result.txt')).rejects.toThrow()
      expect(await readFile(join(source, '.git/index'))).toEqual(originalIndex)
      expect(await workspaceGit(source, ['rev-parse', 'HEAD'], limits)).toEqual(originalHead)
      expect(await readFile(join(source, 'input.txt'), 'utf8')).toBe('concurrent host edit\n')
      if (receipt?.type !== 'workspace/state') throw new Error('missing return receipt')
      for (const branch of Object.keys(receipt.data.branches)) expect((await workspaceGit(source, ['show', `${branch}:result.txt`], limits)).toString()).toBe('agent result\n')
      expect(first.agent.session.snapshotEvents().filter(event => event.type === 'workspace/commit-message-request')).toHaveLength(1)
      console.info('Workspace acceptance: Git return and running service passed')
      await first.dispose(); first = undefined
      if (vmConfig !== undefined) {
        for (const slot of poolPaths) {
          const owner = JSON.parse(await readFile(join(slot, 'owner.json'), 'utf8')) as { workspaceId: string }
          if (owner.workspaceId === receipt.data.workspaceId) {
            await rm(join(slot, 'workspace'), { recursive: true })
            await rm(join(slot, 'owner.json'))
          }
        }
      }
      console.info('Workspace acceptance: resuming after RAM loss')
      first = await ctx.agents.resume({ resumeSessionId: id, agentOptions: { provider: 'mock', model: 'main' } })
      diagnose(first.agent)
      expect(await read(first.agent, 'result.txt')).toBe('agent result\n')
      expect(await command(first.agent, 'git log -1 --format=%s HEAD^')).toBe('feat: add probe\n')
      // Docker's published port can reset connections before the restored application finishes startup.
      if (vmConfig !== undefined) expect(await command(first.agent, 'curl --retry 20 --retry-all-errors --retry-max-time 30 --max-time 5 --retry-delay 1 -fsS http://127.0.0.1:8080')).toContain('id="counter">1</p>')
      console.info('Workspace acceptance: recovery passed')
      const committed = await command(first.agent, 'git rev-parse HEAD')
      first.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Check without changes.' }], source: { kind: 'user' } }))
      await first.agent.whenIdle()
      expect(await command(first.agent, 'git rev-parse HEAD')).toBe(committed)
      expect(first.agent.session.snapshotEvents().filter(event => event.type === 'workspace/commit-message-request')).toHaveLength(1)
      const writer = ctx.agents.withInitiator(first.agent, () => ctx.subprocess.spawn({
        argv: ['/bin/sh', '-c', 'while [ ! -f /workspace/release-writer ]; do sleep 0.05; done; printf retained >background.txt; rm release-writer'],
        cwd: source, stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } }, graceMs: 1000,
      }))
      first.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Finish while the background writer remains active.' }], source: { kind: 'user' } }))
      await first.agent.whenIdle()
      expect(first.agent.session.snapshotEvents().findLast(event => event.type === 'workspace/state')?.data)
        .toMatchObject({ phase: vmConfig === undefined ? 'pending' : 'returned', turn: 3 })
      const world = ctx.agents.withInitiator(first.agent, () => ctx.conversationWorkspaces.capture().containerName)
      // The test owns the tmpfs roots; this external release proves settlement did not kill the writer.
      const slot = await Promise.all(poolPaths.map(async slot => ({ slot, owner: JSON.parse(await readFile(join(slot, 'owner.json'), 'utf8')) as { workspaceId: string } })))
      const backing = slot.find(slot => slot.owner.workspaceId === receipt.data.workspaceId)?.slot
      if (backing === undefined) throw new Error('writer workspace slot missing')
      await writeFile(join(backing, 'workspace', 'release-writer'), '')
      expect((await writer.done).exitCode).toBe(0)
      const savedAgent = first.agent
      await expect.poll(() => savedAgent.session.snapshotEvents().findLast(event => event.type === 'workspace/state')?.data,
        { timeout: 15000 }).toMatchObject({ phase: 'returned', turn: 3 })
      expect(ctx.agents.withInitiator(first.agent, () => ctx.conversationWorkspaces.capture().containerName)).toBe(world)
      expect(await read(first.agent, 'background.txt')).toBe('retained')
      const started = Promise.withResolvers<undefined>()
      const secondId = second.agent.id
      ctx.on('agent/assistant-stream', ({ agent, frame }) => {
        if (agent.id === secondId && frame.type === 'chunk') started.resolve(undefined)
      })
      await command(second.agent, "printf 'cancelled work' >unfinished.txt")
      second.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Begin.' }], source: { kind: 'user' } }))
      await started.promise
      second.agent.cancel({ kind: 'user' }); await second.agent.whenIdle()
      expect(second.agent.session.snapshotEvents().findLast(event => event.type === 'workspace/state')?.data)
        .toMatchObject({ phase: 'checkpointed' })
      expect(await read(second.agent, 'unfinished.txt')).toBe('cancelled work')
    } finally {
      await first?.dispose(); await second?.dispose(); await ctx.fiber.dispose()
      if (rawVm !== undefined) {
        const config = JSON.parse(rawVm) as { command: string; project: string }
        const listed = JSON.parse((await promisify(execFile)(config.command, ['--force-local', 'query', `/1.0/instances?project=${config.project}`])).stdout) as string[]
        for (const id of workspaceIds) if (listed.some(value => new URL(value, 'http://incus').pathname === `/1.0/instances/dsh-${id}`)) {
          await promisify(execFile)(config.command, ['--force-local', 'delete', `dsh-${id}`, '--project', config.project, '--force'])
        }
      }
      for (const slot of poolPaths) {
        let owner: { workspaceId: string }
        try { owner = JSON.parse(await readFile(join(slot, 'owner.json'), 'utf8')) as { workspaceId: string } }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
        if (workspaceIds.includes(owner.workspaceId)) {
          await rm(join(slot, 'workspace'), { recursive: true, force: true })
          await rm(join(slot, 'owner.json'))
        }
      }
      await rm(root, { recursive: true, force: true })
    }
  })
})
