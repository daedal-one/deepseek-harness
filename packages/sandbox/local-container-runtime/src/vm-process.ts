/** Incus-agent process transport; every host argument comes from the runtime owner. @module */
import { spawn } from 'node:child_process'
import { Duplex } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import type { LocalContainerProcessHandle, LocalContainerProcessRequest } from './types.ts'
import type { DevelopmentVmConfig, VmCommand } from './vm-engine.ts'

const PROCESS_ENVIRONMENT = /^[A-Z_][A-Z0-9_]*=/u
const GIT_ENVIRONMENT_NAME = /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/u
const PROCESS_LAUNCHER_READY = Buffer.from('\0dsh-process-ready\0')

const VM_PROCESS_LAUNCHER = String.raw`
import fcntl, json, os, struct, sys, termios, tty

def read_exact(size):
    chunks = []
    while size:
        chunk = os.read(0, size)
        if not chunk: raise RuntimeError('incomplete process envelope')
        chunks.append(chunk)
        size -= len(chunk)
    return b''.join(chunks)

saved = termios.tcgetattr(0) if os.isatty(0) else None
if saved is not None: tty.setraw(0, termios.TCSANOW)
os.write(1, b'\0dsh-process-ready\0')
try:
    size = struct.unpack('>I', read_exact(4))[0]
    limit = int(sys.argv[1])
    if size < 2 or size > limit: raise RuntimeError('invalid process envelope size')
    request = json.loads(read_exact(size))
    if set(request) != {'argv', 'cwd', 'environment', 'tty', 'unit'}: raise RuntimeError('invalid process envelope')
    if not isinstance(request['argv'], list) or not request['argv'] or not all(isinstance(value, str) and value and '\0' not in value for value in request['argv']): raise RuntimeError('invalid process argv')
    if not isinstance(request['cwd'], str) or (request['cwd'] != '/workspace' and not request['cwd'].startswith('/workspace/')): raise RuntimeError('invalid process cwd')
    if not isinstance(request['environment'], list) or not all(isinstance(value, str) and '=' in value and '\0' not in value and '\n' not in value and '\r' not in value for value in request['environment']): raise RuntimeError('invalid process environment')
    if not isinstance(request['tty'], bool) or not isinstance(request['unit'], str): raise RuntimeError('invalid process metadata')
    fd = os.memfd_create('dsh-process-environment', os.MFD_ALLOW_SEALING)
    os.fchmod(fd, 0o400)
    for entry in request['environment']:
        key, value = entry.split('=', 1)
        encoded = value.replace('\\', '\\\\').replace('"', '\\"')
        os.write(fd, (key + '="' + encoded + '"\n').encode())
    os.lseek(fd, 0, os.SEEK_SET)
    fcntl.fcntl(fd, fcntl.F_ADD_SEALS, fcntl.F_SEAL_SEAL | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_GROW | fcntl.F_SEAL_WRITE)
    os.set_inheritable(fd, True)
    path = '/proc/' + str(os.getpid()) + '/fd/' + str(fd)
finally:
    if saved is not None: termios.tcsetattr(0, termios.TCSANOW, saved)
command = ['/usr/bin/systemd-run', '--quiet', '--wait', '--collect', '--service-type=exec', '--unit=' + request['unit'], '--working-directory=' + request['cwd'], '--pty' if request['tty'] else '--pipe', '--property=EnvironmentFile=' + path, '--'] + request['argv']
os.execve(command[0], command, {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'})
`

/** Validate URL-scoped Git process authorization without retaining its values.
 * @param entries - environment assignments issued for one current grant revision.
 * @returns a defensive copy suitable for one process envelope.
 */
export function validateGuestGitAuthorization(entries: readonly string[]): string[] {
  if (entries.length === 0) return []
  const values = new Map<string, string>()
  for (const entry of entries) {
    const separator = entry.indexOf('=')
    const name = separator < 0 ? '' : entry.slice(0, separator)
    const value = separator < 0 ? '' : entry.slice(separator + 1)
    if (!PROCESS_ENVIRONMENT.test(entry) || !GIT_ENVIRONMENT_NAME.test(name) || values.has(name)
      || value.includes('\0') || value.includes('\n') || value.includes('\r')) {
      throw new Error('development-vm: guest Git authorization is not a unique KEY=VALUE environment')
    }
    values.set(name, value)
  }
  const count = Number(values.get('GIT_CONFIG_COUNT'))
  if (!Number.isSafeInteger(count) || count < 1 || values.size !== count * 2 + 1) {
    throw new Error('development-vm: guest Git authorization has an invalid entry count')
  }
  for (let index = 0; index < count; index++) {
    const key = values.get(`GIT_CONFIG_KEY_${index}`)
    const value = values.get(`GIT_CONFIG_VALUE_${index}`)
    if (key === undefined || value === undefined
      || (key !== 'credential.helper' && !/^http\.https:\/\/[^\s]+\/\.extraHeader$/u.test(key))
      || (key === 'credential.helper' ? value !== '' : !/^Authorization: Basic [A-Za-z0-9+/]+=*$/u.test(value))) {
      throw new Error('development-vm: guest Git authorization is not URL scoped')
    }
  }
  return [...entries]
}

/** Allocate a guest systemd service, with Docker workloads remaining guest-daemon owned.
 * @param config - bounded operator configuration.
 * @param name - owner-selected instance name.
 * @param request - validated process request in guest coordinates.
 * @param control - bounded fixed-command transport.
 * @param authorization - one-process Git authorization excluded from host argv and controllers.
 * @returns the attached guest process; termination never targets a host PID.
 */
export async function createVmProcess(
  config: DevelopmentVmConfig,
  name: string,
  request: LocalContainerProcessRequest,
  control: VmCommand,
  authorization: readonly string[] = [],
): Promise<LocalContainerProcessHandle> {
  request.signal?.throwIfAborted()
  const unit = `dsh-process-${randomUUID()}.service`
  const environment = Object.entries(request.environment).filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${value}`)
  const git = validateGuestGitAuthorization(authorization)
  const envelope = Buffer.from(JSON.stringify({
    argv: request.argv,
    cwd: request.cwd,
    environment: [...environment, ...git],
    tty: request.tty,
    unit,
  }))
  if (envelope.length > config.maxOutputBytes) throw new Error('development-vm: guest process envelope exceeds its bound')
  const header = Buffer.alloc(4); header.writeUInt32BE(envelope.length)
  const child = spawn(config.command, ['--force-local', 'exec', name, '--project', config.project,
    '--mode', request.tty ? 'interactive' : 'non-interactive', '--',
    '/usr/bin/python3', '-c', VM_PROCESS_LAUNCHER, String(config.maxOutputBytes)], {
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
      const frame = Buffer.alloc(8); frame[0] = channel; frame.writeUInt32BE(chunk.length, 4)
      data = Buffer.concat([frame, chunk])
    }
    if (!stream.push(data)) { child.stdout.pause(); child.stderr.pause() }
  }
  child.on('error', (error) => { failure = error })
  child.stdin.on('error', (error) => { if ((error as NodeJS.ErrnoException).code !== 'EPIPE') failure = error })
  let closed = false
  let stopping: Promise<void> | undefined
  const stopUnit = (): Promise<void> => stopping ??= control([
    'exec', name, '--project', config.project, '--mode', 'non-interactive', '--', 'systemctl', 'stop', unit,
  ]).then(() => undefined).catch((error: unknown) => {
    if (!(error instanceof Error) || !error.message.includes(`Unit ${unit} not loaded.`)) throw error
  })
  child.on('close', (exitCode) => {
    closed = true; stream.push(null)
    // An Incus attachment can close while its guest service is still running.
    void stopUnit().then(
      () => { done.resolve({ exitCode, ...failure === undefined ? {} : { error: failure.message } }) },
      (error: unknown) => { done.resolve({ exitCode: null, error: `development-vm: guest command cleanup unconfirmed: ${String(error)}` }) },
    )
  })
  let transferTimer: NodeJS.Timeout | undefined
  await Promise.race([
    new Promise<void>((resolve, reject) => {
      let ready = Buffer.alloc(0)
      const cleanup = (): void => {
        child.stdout.off('data', received); child.off('error', failed); child.off('close', ended)
      }
      const failed = (error: Error): void => { cleanup(); reject(error) }
      const ended = (): void => { failed(new Error('guest process launcher closed before its envelope')) }
      const received = (chunk: Buffer): void => {
        ready = Buffer.concat([ready, chunk])
        if (ready.length > PROCESS_LAUNCHER_READY.length
          || !PROCESS_LAUNCHER_READY.subarray(0, ready.length).equals(ready)) {
          failed(new Error('guest process launcher returned an invalid readiness handshake'))
          return
        }
        if (ready.length !== PROCESS_LAUNCHER_READY.length) return
        cleanup()
        child.stdout.on('data', output(1)); child.stderr.on('data', output(2))
        child.stdin.write(Buffer.concat([header, envelope]), (error) => {
          if (error === null || error === undefined) resolve()
          else reject(error)
        })
      }
      child.stdout.on('data', received); child.once('error', failed); child.once('close', ended)
    }),
    new Promise<never>((_resolve, reject) => {
      transferTimer = setTimeout(() => { reject(new Error('guest process envelope transfer timed out')) }, config.timeoutMs)
    }),
  ]).catch(async (error: unknown) => {
    child.kill('SIGKILL')
    await done.promise
    throw new Error('development-vm: guest process envelope transfer failed', { cause: error })
  }).finally(() => { if (transferTimer !== undefined) clearTimeout(transferTimer) })
  if (!request.stdin) child.stdin.end()
  const exec = async (argv: readonly string[]): Promise<Uint8Array> => await control([
    'exec', name, '--project', config.project, '--mode', 'non-interactive', '--', ...argv,
  ])
  const terminal = async (operation: string, args: string[]): Promise<string> => {
    const deadline = Date.now() + config.timeoutMs
    let processId: string
    for (;;) {
      processId = new TextDecoder().decode(await exec([
        'systemctl', 'show', '--value', '--property', 'MainPID', unit,
      ])).trim()
      const value = Number(processId)
      if (Number.isSafeInteger(value) && value > 0) break
      if (Date.now() >= deadline) throw new Error('development-vm: guest process did not publish its main PID')
      await delay(Math.min(config.readinessPollMs, Math.max(1, deadline - Date.now())))
    }
    return new TextDecoder().decode(await exec([
      '/bin/sh', '-ceu', operation, 'dsh-terminal', ...args, processId,
    ]))
  }
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
      terminating ??= (async () => {
        try { await stopUnit() }
        finally { if (!closed) child.kill('SIGKILL'); await done.promise }
      })()
      await terminating
    },
    async waitForRemoval(signal) {
      if (signal?.aborted) return false
      if (signal === undefined) { return (await done.promise).error === undefined }
      return await new Promise<boolean>((resolve) => {
        const aborted = (): void => { resolve(false) }
        signal.addEventListener('abort', aborted, { once: true })
        void done.promise.then((result) => { signal.removeEventListener('abort', aborted); resolve(result.error === undefined) })
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
    // HTTP request completion half-closes guest input while the response remains readable.
    allowHalfOpen: true,
    read() { child.stdout.resume() },
    write(chunk: Buffer, _encoding, callback) { child.stdin.write(chunk, callback) },
    // Keep the process attachment open until the HTTP response or upgraded socket closes.
    final(callback) { callback() },
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
