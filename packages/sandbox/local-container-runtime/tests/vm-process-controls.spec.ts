import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { createVmProcess } from '../src/vm-process.ts'
import type { DevelopmentVmConfig, VmCommand } from '../src/vm-engine.ts'

const childProcess = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: childProcess.spawn }))

type AttachedProcess = ChildProcessWithoutNullStreams & {
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
}

function attachedProcess(ready = true): AttachedProcess {
  const child = new EventEmitter() as AttachedProcess
  Object.assign(child, {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => {
      queueMicrotask(() => child.emit('close', null))
      return true
    }),
  })
  if (ready) queueMicrotask(() => child.stdout.write(Buffer.from('\0dsh-process-ready\0')))
  return child
}

const config: DevelopmentVmConfig = {
  command: '/usr/bin/incus', pythonCommand: '/usr/bin/python3', devicesRoot: '/var/lib/incus/devices',
  project: 'test', storage: 'test', network: 'test', acl: 'test', hostAddresses: ['203.0.113.1'], image: 'a'.repeat(64),
  workspaceUid: 1000, workspaceGid: 1000, maxInstances: 2, cpus: 2, memoryBytes: 4096, diskBytes: 8192,
  timeoutMs: 100, readinessPollMs: 1, maxOutputBytes: 4096,
}

describe('development VM process controls', () => {
  it('does not send the process envelope before the guest disables terminal echo', async () => {
    const child = attachedProcess(false)
    childProcess.spawn.mockReturnValueOnce(child)
    const control = vi.fn<VmCommand>(async () => Buffer.alloc(0))
    const creating = createVmProcess(config, 'dsh-test', {
      argv: ['/bin/sh'], cwd: '/workspace', environment: { TOKEN: 'private' }, tty: true, stdin: true,
    }, control)

    await new Promise(resolve => setImmediate(resolve))
    expect(child.stdin.readableLength).toBe(0)
    child.stdout.write(Buffer.from('\0dsh-process-ready\0'))
    const process = await creating
    expect(child.stdin.readableLength).toBeGreaterThan(0)
    expect(process.stream.read()).toBeNull()
    await process.terminate()
  })

  it('waits for systemd to publish the transient unit main PID before resizing', async () => {
    childProcess.spawn.mockReturnValueOnce(attachedProcess())
    const mainPids = [Buffer.from('0\n'), Buffer.from('42\n')]
    const control = vi.fn<VmCommand>(async (argv) => {
      if (argv.includes('MainPID')) return mainPids.shift() ?? Buffer.from('42\n')
      return Buffer.alloc(0)
    })
    const process = await createVmProcess(config, 'dsh-test', {
      argv: ['/bin/sh'], cwd: '/workspace', environment: {}, tty: true, stdin: true,
    }, control)

    await process.resize(31, 93)
    expect(control.mock.calls.slice(0, 2).every(([argv]) => argv.includes('MainPID'))).toBe(true)
    expect(control.mock.calls[2]?.[0].slice(-7)).toEqual([
      '/bin/sh', '-ceu', 'stty -F "/proc/$3/fd/0" rows "$1" cols "$2"', 'dsh-terminal', '31', '93', '42',
    ])
    await process.terminate()
  })
})
