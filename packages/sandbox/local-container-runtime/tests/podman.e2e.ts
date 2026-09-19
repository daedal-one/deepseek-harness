import { access, mkdtemp, readlink, rm, writeFile } from 'node:fs/promises'
import Dockerode from 'dockerode'
import { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
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
