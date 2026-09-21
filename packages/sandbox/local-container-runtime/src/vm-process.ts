/** Incus-agent process transport; every host argument comes from the runtime owner. @module */
import { spawn } from 'node:child_process'
import { Duplex } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import type { LocalContainerProcessHandle, LocalContainerProcessRequest } from './types.ts'
import type { DevelopmentVmConfig, VmCommand } from './vm-engine.ts'

/** Allocate a guest systemd service, with Docker workloads remaining guest-daemon owned.
 * @param config - bounded operator configuration.
 * @param name - owner-selected instance name.
 * @param request - validated process request in guest coordinates.
 * @param control - bounded fixed-command transport.
 * @returns the attached guest process; termination never targets a host PID.
 */
export async function createVmProcess(
  config: DevelopmentVmConfig, name: string, request: LocalContainerProcessRequest, control: VmCommand,
): Promise<LocalContainerProcessHandle> {
  request.signal?.throwIfAborted()
  const unit = `dsh-process-${randomUUID()}.service`
  const env = Object.entries(request.environment).filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${value}`)
  const child = spawn(config.command, ['--force-local', 'exec', name, '--project', config.project,
    '--mode', request.tty ? 'interactive' : 'non-interactive', '--',
    'systemd-run', '--quiet', '--wait', '--collect', '--service-type=exec', `--unit=${unit}`,
    `--working-directory=${request.cwd}`, request.tty ? '--pty' : '--pipe',
    '/usr/bin/env', '-i', ...env, ...request.argv], {
    env: { HOME: homedir(), PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8' }, stdio: ['pipe', 'pipe', 'pipe'],
  })
  let failure: Error | undefined
  const done = Promise.withResolvers<{ exitCode: number | null; error?: string }>()
  const stream = new Duplex({
    read() { child.stdout.resume(); child.stderr.resume() },
    write(chunk: Buffer, _encoding, callback) { child.stdin.write(chunk, callback) },
    final(callback) { child.stdin.end(callback) },
  })
  const output = (channel: number) => (chunk: Buffer): void => {
    let data = chunk
    if (!request.tty) {
      const header = Buffer.alloc(8); header[0] = channel; header.writeUInt32BE(chunk.length, 4)
      data = Buffer.concat([header, chunk])
    }
    if (!stream.push(data)) { child.stdout.pause(); child.stderr.pause() }
  }
  child.stdout.on('data', output(1)); child.stderr.on('data', output(2))
  child.on('error', (error) => { failure = error })
  child.stdin.on('error', (error) => { if ((error as NodeJS.ErrnoException).code !== 'EPIPE') failure = error })
  if (!request.stdin) child.stdin.end()
  let closed = false
  child.on('close', (exitCode) => {
    closed = true; stream.push(null)
    done.resolve({ exitCode, ...failure === undefined ? {} : { error: failure.message } })
  })
  const exec = async (argv: readonly string[]): Promise<Uint8Array> => await control([
    'exec', name, '--project', config.project, '--mode', 'non-interactive', '--', ...argv,
  ])
  const terminal = async (operation: string, args: string[]): Promise<string> => new TextDecoder().decode(await exec([
    '/bin/sh', '-ceu', 'p=$(systemctl show --value --property MainPID "$1"); test "$p" -gt 0; shift; exec "$@" "$p"',
    'dsh-terminal', unit, '/bin/sh', '-ceu', operation, 'dsh-terminal', ...args,
  ]))
  let terminating: Promise<void> | undefined
  const handle: LocalContainerProcessHandle = {
    id: unit, stream, tty: request.tty, done: done.promise,
    async resize(rows, cols) {
      await terminal('stty -F "/proc/$3/fd/0" rows "$1" cols "$2"', [String(rows), String(cols)])
    },
    async inspect(argv, maxOutputBytes) {
      const bytes = await exec(argv)
      if (bytes.length > maxOutputBytes) throw new Error('development-vm: process inspection output exceeded its bound')
      return { exitCode: 0, output: new TextDecoder().decode(bytes) }
    },
    async signal(signal) { await exec(['systemctl', 'kill', '--kill-whom=main', `--signal=${signal}`, unit]) },
    async terminate() {
      if (closed) return
      terminating ??= (async () => {
        try { await exec(['systemctl', 'stop', unit]) }
        finally { child.kill('SIGKILL'); await done.promise }
      })()
      await terminating
    },
    async waitForRemoval(signal) {
      if (closed) return true
      if (signal?.aborted) return false
      if (signal === undefined) { await done.promise; return true }
      return await new Promise<boolean>((resolve) => {
        const aborted = (): void => { resolve(false) }
        signal.addEventListener('abort', aborted, { once: true })
        void done.promise.then(() => { signal.removeEventListener('abort', aborted); resolve(true) })
      })
    },
    async inspectTerminalForeground() {
      const result = await terminal('ps -o tpgid= -p "$1"', [])
      const group = Number(result.trim())
      return Number.isSafeInteger(group) && group > 0 ? { processGroupId: group, inputWaiting: true } : undefined
    },
    async signalTerminalForeground(signal) {
      const result = await terminal('p=$(ps -o tpgid= -p "$2" | tr -d " "); test "$p" -gt 0; kill -s "$1" -- "-$p"; printf "%s" "$p"', [signal])
      return Number(result.trim())
    },
  }
  const aborted = (): void => { void handle.terminate().catch(() => undefined) }
  request.signal?.addEventListener('abort', aborted, { once: true })
  void done.promise.then(() => request.signal?.removeEventListener('abort', aborted))
  if (request.signal?.aborted) { await handle.terminate(); request.signal.throwIfAborted() }
  return handle
}

/** Open a byte tunnel to a guest-loopback development port through the Incus agent.
 * @param config - owner configuration.
 * @param name - retained VM name.
 * @param port - validated unprivileged guest port.
 * @returns a stream which owns the local Incus attachment until close.
 */
export async function connectVmPreview(config: DevelopmentVmConfig, name: string, port: number): Promise<Duplex> {
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('development-preview: port must be between 1024 and 65535')
  const child = spawn(config.command, ['--force-local', 'exec', name, '--project', config.project,
    '--mode', 'non-interactive', '--', '/usr/bin/socat', 'STDIO', `TCP:127.0.0.1:${port}`], {
    env: { HOME: homedir(), PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8' }, stdio: ['pipe', 'pipe', 'ignore'],
  })
  let closed = false
  const stream = new Duplex({
    allowHalfOpen: false,
    read() { child.stdout.resume() },
    write(chunk: Buffer, _encoding, callback) { child.stdin.write(chunk, callback) },
    final(callback) { child.stdin.end(callback) },
    destroy(error, callback) {
      child.kill('SIGKILL'); child.stdin.destroy(); child.stdout.destroy()
      if (closed) callback(error)
      else child.once('close', () => { callback(error) })
    },
  })
  child.stdout.on('data', (chunk: Buffer) => { if (!stream.push(chunk)) child.stdout.pause() })
  child.stdout.on('end', () => stream.push(null))
  child.stdin.on('error', error => stream.destroy(error))
  stream.on('error', () => child.kill('SIGKILL'))
  child.on('error', error => stream.destroy(error))
  child.on('close', (code) => {
    closed = true
    if (!stream.destroyed && code !== 0) stream.destroy(new Error('development-preview: guest connection closed'))
    else stream.push(null)
  })
  await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
  return stream
}
