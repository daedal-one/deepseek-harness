import { access, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import Dockerode from 'dockerode'
import { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { EnvironmentAccess } from '../src/environment-access.ts'
import { cloneEnvironmentRepository } from '../src/remote-import.ts'
import { workspaceGit } from '../src/workspace-git.ts'
import { join } from 'node:path'
import LocalContainerRuntime from '@deepseek-ai/dsh-local-container-runtime'
import type { PodmanContainerInspect } from '@deepseek-ai/dsh-local-container-runtime'

const socketPath = process.env.DSH_PODMAN_SOCKET
const image = process.env.DSH_PODMAN_IMAGE
const enabled = socketPath !== undefined && socketPath !== '' && image !== undefined && image !== ''

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

describe.skipIf(!enabled)('rootless Podman Engine API runtime owner', () => {
  it('preserves the workspace owner after concurrent short-lived executable probes', async () => {
    if (socketPath === undefined || image === undefined) throw new Error('Podman integration environment disappeared')
    const ctx = new Context()
    let shutdowns = 0
    try {
      await ctx.plugin(LocalContainerRuntime, {
        socketPath, image, manageService: false, serviceStartupTimeoutMs: 10000,
        user: 'dsh', environment: { HOME: '/home/dsh', LANG: 'C.UTF-8', PATH: '/usr/local/bin:/usr/bin:/bin' },
        memoryBytes: 268435456, nanoCpus: 500000000, pidsLimit: 128, tmpfsBytes: 67108864,
        engineRequestTimeoutMs: 10000, maxLiveProcesses: 4, lifetimeMs: 300000, stopTimeoutSeconds: 2,
      })
      const runtime = ctx.localContainerRuntime
      await runtime.getContainer()
      runtime.registerWorkspaceOwner(async () => { shutdowns++ })
      const outcomes = await Promise.allSettled(Array.from({ length: 24 }, (_, index) => runtime.executeController({
        argv: ['/bin/sh', '-c', 'command -v -- "$1"', 'dsh', `dsh-absent-editor-${index}`],
        stdin: new Uint8Array(), maxOutputBytes: 1024, deadlineMs: 30000,
      })))
      expect(outcomes.map(outcome => outcome.status === 'fulfilled' ? outcome.value.exitCode : String(outcome.reason)))
        .toEqual(Array.from({ length: 24 }, () => 127))
      expect(shutdowns).toBe(0)
      const result = await runtime.executeController({
        argv: ['/bin/cat'], stdin: Buffer.from('workspace remains available'), maxOutputBytes: 1024, deadlineMs: 30000,
      })
      expect(result.exitCode).toBe(0)
      expect(Buffer.from(result.stdout).toString()).toBe('workspace remains available')
    } finally { await ctx.fiber.dispose() }
    expect(shutdowns).toBe(1)
  })

  it.skipIf(process.env.DSH_PODMAN_EGRESS !== '1')('clones an approved remote absent from the catalog through a sandbox process', async () => {
    if (socketPath === undefined || image === undefined) throw new Error('Podman integration environment disappeared')
    const root = await mkdtemp('/tmp/dsh-new-remote-e2e-')
    const ctx = new Context()
    let world: Awaited<ReturnType<LocalContainerRuntime['createWorkspace']>> | undefined
    try {
      const access = await EnvironmentAccess.open({ id: 'remote-only', name: 'Remote-only test', grantLifetimeMs: 3600000,
        repositories: [], initialGrants: [], remoteRepositories: { credentialTimeoutMs: 1000, providers: [] } }, root, 16384)
      const remote = 'https://github.com/octocat/Hello-World.git'
      await access.approve(remote, 'fetch', { kind: 'user', sessionId: 'qualification', questionId: 'approved', reason: 'Test remote-only import.' }, 0, new AbortController().signal)
      await ctx.plugin(LocalContainerRuntime, {
        socketPath, image, network: 'outbound', manageService: false, serviceStartupTimeoutMs: 10000,
        user: 'dsh', environment: { HOME: '/home/dsh', LANG: 'C.UTF-8', PATH: '/usr/local/bin:/usr/bin:/bin' },
        memoryBytes: 268435456, nanoCpus: 500000000, pidsLimit: 128, tmpfsBytes: 67108864,
        engineRequestTimeoutMs: 10000, maxLiveProcesses: 4, lifetimeMs: 300000, stopTimeoutSeconds: 2,
      })
      const backing = join(root, 'world'); await mkdir(backing, { mode: 0o700 })
      world = await ctx.localContainerRuntime.createWorkspace(backing, () => access.authorize())
      const limits = { gitCommand: '/usr/bin/git', resourceLimitCommand: '/usr/bin/prlimit', gitMemoryBytes: 268435456,
        maxBytes: 4194304, maxEntries: 1000, timeoutMs: 30000, authorName: 'DSH', authorEmail: 'dsh@localhost' }
      const repository = access.repository(remote)
      await cloneEnvironmentRepository(world.runtime, repository, limits, 8388608, new AbortController().signal)
      expect((await workspaceGit(repository.source, ['remote', 'get-url', 'origin'], limits)).toString().trim()).toBe(remote)
      expect((await workspaceGit(repository.source, ['status', '--porcelain'], limits)).length).toBe(0)
      expect((await workspaceGit(repository.source, ['rev-parse', 'HEAD'], limits)).toString().trim()).toMatch(/^[a-f0-9]{40}$/u)
      expect(await readFile(join(repository.source, '.git/config'), 'utf8')).not.toMatch(/credential|extraHeader/u)
    } finally { await world?.dispose(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  })

  it.skipIf(process.env.DSH_PODMAN_EGRESS !== '1')('fetches HTTPS and a public Git remote inside an isolated outbound process', async () => {
    if (socketPath === undefined || image === undefined) throw new Error('Podman integration environment disappeared')
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalContainerRuntime, {
      socketPath, image, network: 'outbound', manageService: false, serviceStartupTimeoutMs: 10000,
      user: 'dsh', environment: { HOME: '/home/dsh', LANG: 'C.UTF-8', PATH: '/usr/local/bin:/usr/bin:/bin' },
      memoryBytes: 268435456, nanoCpus: 500000000, pidsLimit: 128, tmpfsBytes: 67108864,
      engineRequestTimeoutMs: 10000, maxLiveProcesses: 4, lifetimeMs: 300000, stopTimeoutSeconds: 2,
    })
    try {
      const process = await ctx.localContainerRuntime.createProcess({
        argv: ['/usr/bin/python3', '-c', [
          'import os,subprocess,urllib.request',
          'assert not os.path.exists("/home/carlo/.dsh/.credentials.yaml")',
          'assert urllib.request.urlopen("https://example.com", timeout=15).status == 200',
          'r=subprocess.run(["git","ls-remote","https://github.com/octocat/Hello-World.git","HEAD"],check=True,capture_output=True,text=True,timeout=30)',
          'assert r.stdout.strip().endswith("HEAD")',
          'print("HTTPS_AND_GIT_OK")',
        ].join('\n')],
        cwd: '/workspace', environment: {}, tty: true, rows: 24, cols: 80, stdin: false,
      })
      const output = readAll(process.stream)
      expect(await process.done).toEqual({ exitCode: 0 })
      expect(await output).toContain('HTTPS_AND_GIT_OK')
    } finally { await fiber.dispose() }
  })

  it.skipIf(process.env.DSH_PODMAN_EGRESS !== '1' || process.env.DSH_PRIVATE_REPO_URL === undefined)('reads an approved private repository with environment-issued credentials', async () => {
    const repository = process.env.DSH_PRIVATE_REPO_URL
    const source = process.env.DSH_PRIVATE_REPO_SOURCE
    const credentialCommand = process.env.DSH_PRIVATE_REPO_FETCH_HELPER
    if (socketPath === undefined || image === undefined || repository === undefined || source === undefined || credentialCommand === undefined) throw new Error('private repository integration configuration is incomplete')
    const root = await mkdtemp('/tmp/dsh-private-repository-')
    const ctx = new Context()
    let world: Awaited<ReturnType<LocalContainerRuntime['createWorkspace']>> | undefined
    try {
      const environment = await EnvironmentAccess.open({ id: 'private-repository-e2e', name: 'Private repository E2E', grantLifetimeMs: 3600000,
        repositories: [{ url: repository, source, fetchCredentialCommand: credentialCommand, credentialTimeoutMs: 15000 }],
        initialGrants: [{ repository, access: 'fetch' }] }, root, 16384)
      await ctx.plugin(LocalContainerRuntime, {
        socketPath, image, network: 'outbound', manageService: false, serviceStartupTimeoutMs: 10000,
        user: 'dsh', environment: { HOME: '/home/dsh', LANG: 'C.UTF-8', PATH: '/usr/local/bin:/usr/bin:/bin' },
        memoryBytes: 268435456, nanoCpus: 500000000, pidsLimit: 128, tmpfsBytes: 67108864,
        engineRequestTimeoutMs: 10000, maxLiveProcesses: 4, lifetimeMs: 300000, stopTimeoutSeconds: 2,
      })
      const backing = await mkdtemp('/tmp/dsh-private-repository-world-')
      try {
        world = await ctx.localContainerRuntime.createWorkspace(backing, () => environment.authorize())
        const process = await world.runtime.createProcess({
          argv: ['/usr/bin/python3', '-c', [
            'import os,subprocess,sys',
            'assert not os.path.exists("/home/carlo/.config/daedal-one/github-app/config.json")',
            'r=subprocess.run(["git","ls-remote",sys.argv[1],"HEAD"],capture_output=True,text=True,timeout=30)',
            'assert r.returncode == 0 and r.stdout.strip().endswith("HEAD"), "private repository fetch failed"',
            'print("PRIVATE_REPOSITORY_FETCH_OK")',
          ].join('\n'), repository],
          cwd: '/workspace', environment: {}, tty: true, rows: 24, cols: 80, stdin: false,
        })
        const output = readAll(process.stream)
        expect(await process.done).toEqual({ exitCode: 0 })
        expect(await output).toContain('PRIVATE_REPOSITORY_FETCH_OK')
        const controller = await world.runtime.executeController({ argv: ['/usr/bin/python3', '-c', 'import os; assert not any(k.startswith("GIT_CONFIG") for k in os.environ)'], stdin: new Uint8Array(), maxOutputBytes: 1024, deadlineMs: 10000 })
        expect(controller.exitCode).toBe(0)
      } finally { await world?.dispose(); await rm(backing, { recursive: true, force: true }) }
    } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  })

  it('creates, externally inspects, and removes a rootless constrained container', async () => {
    if (socketPath === undefined || image === undefined) throw new Error('Podman integration environment disappeared before setup')
    const docker = new Dockerode({ socketPath })
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalContainerRuntime, {
      socketPath,
      manageService: false,
      serviceStartupTimeoutMs: 10_000,
      image,
      user: 'dsh',
      environment: {
        DSH_OPERATION_ID: 'podman-integration',
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
    })
    const sentinelRoot = await mkdtemp('/tmp/dsh-host-sentinel-')
    const sentinel = `${sentinelRoot}/host-only`
    await writeFile(sentinel, 'host-only-sentinel', { mode: 0o600 })
    let containerId: string | undefined
    let backingDirectory: string | undefined
    try {
      const handle = await ctx.localContainerRuntime.getContainer()
      containerId = handle.id
      const inspect = await docker.getContainer(handle.id).inspect() as unknown as PodmanContainerInspect
      const mounts = inspect.Mounts
      const workspace = mounts?.find(mount => mount.Destination === '/workspace')

      expect(inspect.State?.Running).toBe(true)
      expect(inspect.Config).toMatchObject({
        User: 'dsh',
        WorkingDir: '/workspace',
      })
      expect(inspect.HostConfig).toMatchObject({
        ReadonlyRootfs: true,
        NetworkMode: 'none',
      })
      expect(mounts).toHaveLength(1)
      expect(workspace).toMatchObject({ Destination: '/workspace', Type: 'bind', RW: true })
      expect(workspace?.Source).toMatch(/^\/tmp\/dsh-local-container-runtime-/u)
      backingDirectory = workspace?.Source

      const namespaces = ['pid', 'net', 'mnt', 'ipc', 'uts']
      const hostNamespaces = await Promise.all(namespaces.map(name => readlink(`/proc/self/ns/${name}`)))
      const probe = await ctx.localContainerRuntime.executeController({
        argv: ['/usr/bin/python3', '-c', [
          'import json,os,socket,sys',
          'assert not os.path.exists(sys.argv[1])',
          'assert not os.path.exists("/home/carlo/.dsh/.credentials.yaml")',
          'assert not os.path.exists("/var/run/docker.sock")',
          'assert not os.path.exists("/dev/sda") and not os.path.exists("/dev/nvme0n1")',
          'assert not any(any(word in name.upper() for word in ["SECRET","TOKEN","PASSWORD","API_KEY"]) for name in os.environ)',
          'assert [os.readlink("/proc/self/ns/"+name) for name in json.loads(sys.argv[2])] != json.loads(sys.argv[3])',
          'sock=socket.socket(); sock.settimeout(1)',
          'assert sock.connect_ex(("192.0.2.1",443)) != 0',
          'print(json.dumps([os.readlink("/proc/self/ns/"+name) for name in json.loads(sys.argv[2])]))',
        ].join('\n'), sentinel, JSON.stringify(namespaces), JSON.stringify(hostNamespaces)],
        stdin: new Uint8Array(), maxOutputBytes: 4096, deadlineMs: 10_000,
      })
      expect(probe.exitCode).toBe(0)
      const isolatedNamespaces = JSON.parse(Buffer.from(probe.stdout).toString('utf8')) as string[]
      for (const [index, hostNamespace] of hostNamespaces.entries()) expect(isolatedNamespaces[index]).not.toBe(hostNamespace)

      const processHandle = await ctx.localContainerRuntime.createProcess({
        argv: ['/bin/sh', '-c', 'test "$(id -u)" = 1000 && test "$(grep "^CapEff:" /proc/self/status | cut -f2)" = 0000000000000000 && test "$(grep "^NoNewPrivs:" /proc/self/status | cut -f2)" = 1 && test "$(cat /sys/fs/cgroup/memory.max)" = 268435456 && test "$(cat /sys/fs/cgroup/pids.max)" = 128 && test "$(cat /sys/fs/cgroup/cpu.max)" = "50000 100000" && test "$(ls /sys/class/net | tr "\\n" ",")" = "lo," && ! touch /usr/process-root-write-probe 2>/dev/null && printf child >/workspace/process-visible.txt && printf process-output'],
        cwd: '/workspace',
        environment: {},
        tty: true,
        stdin: false,
        rows: 24,
        cols: 80,
      })
      const output = readAll(processHandle.stream)
      const [processOutcome, processOutput] = await Promise.all([processHandle.done, output])
      expect({ processOutcome, processOutput }).toEqual({ processOutcome: { exitCode: 0 }, processOutput: 'process-output' })
      await expect(docker.getContainer(processHandle.id).inspect()).rejects.toBeDefined()
      const visible = await ctx.localContainerRuntime.executeController({
        argv: ['/bin/cat', '/workspace/process-visible.txt'],
        stdin: new Uint8Array(),
        maxOutputBytes: 1024,
        deadlineMs: 10_000,
      })
      expect(new TextDecoder().decode(visible.stdout)).toBe('child')

      const descendant = await ctx.localContainerRuntime.createProcess({
        argv: ['/bin/sh', '-c', 'sleep 300 & wait'],
        cwd: '/workspace',
        environment: {},
        tty: true,
        stdin: false,
        rows: 24,
        cols: 80,
      })
      descendant.stream.resume()
      await descendant.terminate()
      await expect(descendant.waitForRemoval()).resolves.toBe(true)
      await expect(docker.getContainer(descendant.id).inspect()).rejects.toBeDefined()
    } finally {
      try { await fiber.dispose() } finally { await rm(sentinelRoot, { recursive: true, force: true }) }
    }

    if (containerId === undefined || backingDirectory === undefined) throw new Error('runtime did not publish its owned resources')
    await expect(docker.getContainer(containerId).inspect()).rejects.toBeDefined()
    await expect(access(backingDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe.skipIf(image === undefined || image === '')('managed rootless Podman service', () => {
  it('owns its private API socket with the execution world', async () => {
    if (image === undefined) throw new Error('Podman integration image disappeared before setup')
    const managedSocket = `/tmp/dsh-podman-managed-${process.pid}-${randomUUID()}.sock`
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalContainerRuntime, {
      socketPath: managedSocket,
      manageService: true,
      podmanCommand: '/usr/bin/podman',
      serviceStartupTimeoutMs: 10_000,
      image,
      user: 'dsh',
      environment: { HOME: '/home/dsh', LANG: 'C.UTF-8', PATH: '/usr/local/bin:/usr/bin:/bin' },
      memoryBytes: 268_435_456,
      nanoCpus: 500_000_000,
      pidsLimit: 128,
      tmpfsBytes: 67_108_864,
      engineRequestTimeoutMs: 10_000,
      maxLiveProcesses: 2,
      lifetimeMs: 60_000,
      stopTimeoutSeconds: 2,
    })
    try {
      await expect(ctx.localContainerRuntime.getContainer()).resolves.toMatchObject({ workspacePath: '/workspace' })
      await expect(access(managedSocket)).resolves.toBeUndefined()
    } finally {
      await fiber.dispose()
    }
    await expect(access(managedSocket)).rejects.toMatchObject({ code: 'ENOENT' })
  }, 30_000)
})
