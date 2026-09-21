/** Host-owned Incus VM lifecycle. Guest input never selects host commands or paths. @module */
import type { ConversationWorkspaceId } from './workspace-types.ts'
import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { isIP } from 'node:net'
import { homedir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { VM_FILESYSTEM_FENCE } from './vm-fence.ts'

/** Operator-provisioned VM resources and finite operation bounds. */
export interface DevelopmentVmConfig {
  /** Absolute Incus executable on the host. */
  command: string
  /** Absolute host Python with pidfd support. */
  pythonCommand: string
  /** Incus-owned device metadata directory, outside all guest mounts. */
  devicesRoot: string
  /** Dedicated Incus project. */
  project: string
  /** Dedicated durable storage pool. */
  storage: string
  /** Managed bridge with the required ACL. */
  network: string
  /** Network ACL owned by the deployment. */
  acl: string
  /** All public host addresses, denied in addition to non-public ranges. */
  hostAddresses: string[]
  /** Local Incus image fingerprint, never a mutable remote alias. */
  image: string
  /** Host UID receiving guest-root writes in the private shared directory. */
  workspaceUid: number
  /** Host GID receiving guest-root writes in the private shared directory. */
  workspaceGid: number
  /** Maximum retained VMs enforced by the dedicated Incus project. */
  maxInstances: number
  /** VM virtual CPU count. */
  cpus: number
  /** VM RAM quota in bytes. */
  memoryBytes: number
  /** Durable guest root and Docker storage quota in bytes. */
  diskBytes: number
  /** Bound on one Incus operation, including startup and snapshot. */
  timeoutMs: number
  /** Guest-agent readiness polling interval. */
  readinessPollMs: number
  /** Combined command output byte limit. */
  maxOutputBytes: number
}

/** Fixed command executor; tests replace the process boundary only. */
export type VmCommand = (argv: readonly string[], input?: Uint8Array) => Promise<Uint8Array>

/** Non-public destinations forbidden even when public HTTP egress is allowed. */
export const VM_DENIED_NETWORKS = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8',
  '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16',
  '198.18.0.0/15', '224.0.0.0/4', '240.0.0.0/4',
] as const

/** Bounded host command execution with a replacement environment and no shell.
 * @param config - validated operator command and bounds.
 * @returns executor whose failures include bounded diagnostics.
 */
export function incusCommand(config: DevelopmentVmConfig): VmCommand {
  return hostCommand(config, ['--force-local'])
}

function hostCommand(config: DevelopmentVmConfig, prefix: string[]): VmCommand {
  return async (argv, input) => await new Promise<Uint8Array>((resolve, reject) => {
    const child = spawn(config.command, [...prefix, ...argv], {
      env: { HOME: homedir(), PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []; const stderr: Buffer[] = []
    let size = 0; let failure: Error | undefined
    const stop = (error: Error): void => { failure ??= error; child.kill('SIGKILL') }
    const timer = setTimeout(() =>{  stop(new Error('development-vm: Incus operation timed out')) }, config.timeoutMs)
    const collect = (chunks: Buffer[]) => (chunk: Buffer): void => {
      size += chunk.length
      if (size > config.maxOutputBytes) stop(new Error('development-vm: Incus output limit exceeded'))
      else chunks.push(chunk)
    }
    child.stdout.on('data', collect(stdout)); child.stderr.on('data', collect(stderr))
    child.on('error', (error) => { failure ??= error })
    child.stdin.on('error', (error) => { if ((error as NodeJS.ErrnoException).code !== 'EPIPE') stop(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (failure !== undefined) reject(failure)
      else if (code !== 0) reject(new Error(`development-vm: Incus ${argv[0]} exited ${code}: ${Buffer.concat(stderr).toString().trim()}`))
      else resolve(Buffer.concat(stdout))
    })
    child.stdin.end(input)
  })
}

/** Hypervisor operations scoped to a dedicated project and deterministic conversation names. */
export class IncusDevelopmentVms {
  private readonly run: VmCommand
  private readonly fence: VmCommand
  private readonly frozen = new Map<ConversationWorkspaceId, unknown[]>()
  constructor(readonly config: DevelopmentVmConfig, command?: VmCommand, fence?: VmCommand) {
    if (!isAbsolute(config.command) || config.command.includes('\0')) throw new Error('development-vm: command must be absolute')
    if (!isAbsolute(config.pythonCommand) || !isAbsolute(config.devicesRoot)) throw new Error('development-vm: host controller paths must be absolute')
    for (const value of [config.project, config.storage, config.network, config.acl]) {
      if (!/^[a-z][a-z0-9-]{0,62}$/u.test(value)) throw new Error('development-vm: invalid resource name')
    }
    if (!/^[a-f0-9]{64}$/u.test(config.image)) throw new Error('development-vm: image must be a local SHA-256 fingerprint')
    for (const value of [config.maxInstances, config.cpus, config.memoryBytes, config.diskBytes,
      config.timeoutMs, config.readinessPollMs, config.maxOutputBytes]) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error('development-vm: resource bounds must be positive safe integers')
    }
    if (config.timeoutMs > 2_147_483_647) throw new Error('development-vm: timeout exceeds timer range')
    if (config.hostAddresses.length === 0 || config.hostAddresses.some(address => isIP(address) !== 4)) throw new Error('development-vm: list every public IPv4 host address; IPv6 must be disabled on the bridge')
    for (const value of [config.workspaceUid, config.workspaceGid]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error('development-vm: workspace identity must be unprivileged')
    }
    if (config.workspaceUid !== config.workspaceGid) throw new Error('development-vm: shared source requires matching host UID and GID')
    this.run = command ?? incusCommand(config)
    this.fence = fence ?? hostCommand({ ...config, command: config.pythonCommand }, [])
  }

  /** Validate the host-enforced network before allocating or resuming a guest. */
  async verifyNetwork(): Promise<void> {
    const project = object(await this.json(['query', `/1.0/projects/${this.config.project}`]))
    if (object(project.config)['limits.instances'] !== String(this.config.maxInstances)) throw new Error('development-vm: project instance quota differs from configuration')
    const network = object(await this.json(['query', `/1.0/networks/${this.config.network}`]))
    const config = object(network.config)
    if (network.type !== 'bridge' || network.managed !== true || config['ipv6.address'] !== 'none'
      || config['security.acls'] !== this.config.acl
      || config['security.acls.default.egress.action'] !== 'reject'
      || config['security.acls.default.ingress.action'] !== 'reject') throw new Error('development-vm: managed network isolation differs from configuration')
    const acl = object(await this.json(['query', `/1.0/network-acls/${this.config.acl}`]))
    if (!Array.isArray(acl.egress) || !Array.isArray(acl.ingress) || acl.ingress.length !== 0) throw new Error('development-vm: unexpected network ACL')
    const required = new Set<string>([...VM_DENIED_NETWORKS, ...this.config.hostAddresses.map(ip => `${ip}/32`)])
    for (const raw of acl.egress) {
      const rule = object(raw)
      if (rule.state !== 'enabled') throw new Error('development-vm: ACL rules must be enabled')
      if (rule.source || rule.source_port || rule.icmp_type || rule.icmp_code) throw new Error('development-vm: unexpected ACL selector')
      if (rule.action === 'drop' && !rule.protocol && !rule.destination_port && typeof rule.destination === 'string') {
        for (const destination of rule.destination.split(',')) required.delete(destination)
      } else if (rule.action === 'allow' && rule.protocol === 'tcp' && !rule.destination && rule.destination_port === '80,443') {
        // Only public HTTP(S); destination drops take precedence over allows in Incus.
      } else if (rule.action === 'allow' && rule.protocol === 'udp' && rule.destination_port === '53'
        && rule.destination === '1.1.1.1/32,8.8.8.8/32') {
        // Explicit public DNS resolvers, subject to the same destination drops.
      } else throw new Error('development-vm: unsupported network ACL rule')
    }
    if (required.size !== 0) throw new Error('development-vm: network ACL omits forbidden destinations')
  }

  /** Allocate a stopped VM; callers restore source before starting it.
   * @param id - supervisor-derived conversation workspace identifier.
   * @param directory - private memory-backed source directory, validated by the workspace owner.
   * @returns retained instance name.
   */
  async create(id: ConversationWorkspaceId, directory: string): Promise<string> {
    const name = this.name(id)
    if (!isAbsolute(directory) || directory.includes('\0')) throw new Error('development-vm: invalid private workspace directory')
    await this.verifyNetwork()
    await this.call(['init', this.config.image, name, '--vm', '--no-profiles', '--storage', this.config.storage,
      '-c', `limits.cpu=${this.config.cpus}`, '-c', `limits.memory=${this.config.memoryBytes}`,
      '-c', 'boot.autostart=false', '-c', `raw.idmap=both ${this.config.workspaceUid} 0`, '-c', `user.dsh.workspace=${id}`, '-d', `root,size=${this.config.diskBytes}`])
    try {
      await this.call(['config', 'device', 'add', name, 'workspace', 'disk', `source=${directory}`, 'path=/workspace'])
      await this.call(['config', 'device', 'add', name, 'eth0', 'nic', `network=${this.config.network}`,
        'security.mac_filtering=true', 'security.ipv4_filtering=true', 'security.ipv6_filtering=true'])
      await this.verify(id, directory)
      return name
    } catch (error) {
      try { await this.call(['delete', name, '--force']) }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'development-vm: allocation and rollback failed') }
      throw error
    }
  }

  /** Verify an existing instance before giving it workspace authority.
   * @param id - supervisor-derived identifier.
   * @param directory - expected sole shared source directory.
   */
  async verify(id: ConversationWorkspaceId, directory: string): Promise<void> {
    const instance = object(await this.json(['query', `/1.0/instances/${this.name(id)}?project=${this.config.project}`]))
    const config = object(instance.expanded_config); const devices = object(instance.expanded_devices)
    if (instance.type !== 'virtual-machine' || !Array.isArray(instance.profiles) || instance.profiles.length !== 0
      || config['user.dsh.workspace'] !== id || config['limits.cpu'] !== String(this.config.cpus)
      || config['limits.memory'] !== String(this.config.memoryBytes) || config['boot.autostart'] !== 'false'
      || config['raw.idmap'] !== `both ${this.config.workspaceUid} 0`
      || Object.keys(config).some(key => (key.startsWith('raw.') && key !== 'raw.idmap') || key.startsWith('security.'))
      || Object.keys(devices).sort().join(',') !== 'eth0,root,workspace') throw new Error('development-vm: instance controls differ from configuration')
    const root = object(devices.root); const workspace = object(devices.workspace); const nic = object(devices.eth0)
    if (root.type !== 'disk' || root.path !== '/' || root.pool !== this.config.storage || root.size !== String(this.config.diskBytes)
      || workspace.type !== 'disk' || workspace.path !== '/workspace' || workspace.source !== directory
      || nic.type !== 'nic' || nic.network !== this.config.network
      || nic['security.mac_filtering'] !== 'true' || nic['security.ipv4_filtering'] !== 'true' || nic['security.ipv6_filtering'] !== 'true') throw new Error('development-vm: instance devices differ from configuration')
  }

  /** Determine whether the retained guest exists without treating transport failures as absence.
   * @param id - retained workspace identifier.
   * @returns whether Incus lists the exact project-local name.
   */
  async exists(id: ConversationWorkspaceId): Promise<boolean> {
    const values = await this.json(['query', `/1.0/instances?project=${this.config.project}`])
    if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) throw new Error('development-vm: invalid instance listing')
    return values.some(value => new URL(value as string, 'http://incus').pathname === `/1.0/instances/${this.name(id)}`)
  }

  /** Restore a guest disk to the acknowledged source generation while stopped.
   * @param id - retained workspace identifier.
   * @param generation - acknowledged source checkpoint generation.
   * @param directory - newly leased private source directory.
   */
  async restore(id: ConversationWorkspaceId, generation: number, directory: string): Promise<void> {
    if (await this.state(id) !== 'Stopped') throw new Error('development-vm: restore requires a stopped guest')
    await this.call(['snapshot', 'restore', this.name(id), `source-${generation}`])
    await this.call(['config', 'device', 'set', this.name(id), 'workspace', `source=${directory}`])
    await this.verify(id, directory)
  }

  /** Start a verified instance; await its source mount and systemd command execution.
   * @param id - retained workspace identifier.
   */
  async start(id: ConversationWorkspaceId): Promise<void> {
    await this.call(['start', this.name(id)])
    const deadline = Date.now() + this.config.timeoutMs
    for (;;) {
      try {
        await this.call(['exec', this.name(id), '--', '/bin/sh', '-c',
          '/usr/bin/mountpoint -q /workspace && /usr/bin/docker info >/dev/null && /usr/bin/systemd-run --quiet --wait --collect --service-type=exec --working-directory=/workspace /bin/true || { printf \"development-vm: guest toolchain not ready\\n\" >&2; exit 75; }'])
        return
      }
      catch (error) {
        if (!(error instanceof Error) || (!error.message.includes('agent') && !error.message.includes('Instance is not running')
          && !error.message.includes('guest toolchain not ready'))
          || Date.now() >= deadline) throw error
        await delay(Math.min(this.config.readinessPollMs, Math.max(1, deadline - Date.now())))
      }
    }
  }

  /** Freeze every guest CPU; no guest cooperation establishes this barrier.
   * @param id - retained workspace identifier.
   */
  async freeze(id: ConversationWorkspaceId): Promise<void> {
    const state = await this.state(id)
    if (state === 'Running') {
      await this.call(['exec', this.name(id), '--', '/bin/sync'])
      await this.call(['pause', this.name(id)])
    }
    if (await this.state(id) !== 'Frozen') throw new Error('development-vm: hypervisor did not establish the writer barrier')
    const members = await this.fenceOperation(id, 'freeze')
    this.frozen.set(id, members)
  }

  /** Reopen guest execution only after successful maintenance.
   * @param id - retained workspace identifier.
   */
  async unfreeze(id: ConversationWorkspaceId): Promise<void> {
    if (await this.state(id) !== 'Frozen') throw new Error('development-vm: cannot release an absent writer barrier')
    const members = this.frozen.get(id)
    if (members === undefined) throw new Error('development-vm: filesystem writer barrier is absent')
    await this.fenceOperation(id, 'thaw', members)
    await this.call(['start', this.name(id)])
    this.frozen.delete(id)
    if (await this.state(id) !== 'Running') throw new Error('development-vm: guest did not resume')
  }

  /** Retain a crash-consistent guest disk generation while all writers are frozen.
   * @param id - retained workspace identifier.
   * @param generation - matching source checkpoint generation.
   */
  async checkpoint(id: ConversationWorkspaceId, generation: number): Promise<void> {
    if (!Number.isSafeInteger(generation) || generation < 1) throw new Error('development-vm: invalid checkpoint generation')
    const state = await this.state(id)
    if (state !== 'Stopped' && (state !== 'Frozen' || !this.frozen.has(id))) throw new Error('development-vm: checkpoint requires a stopped or frozen guest and filesystem helper')
    const snapshots = await this.json(['query', `/1.0/instances/${this.name(id)}/snapshots?project=${this.config.project}`])
    if (!Array.isArray(snapshots) || snapshots.some(value => typeof value !== 'string')) throw new Error('development-vm: invalid snapshot listing')
    if (snapshots.some(value => new URL(value as string, 'http://incus').pathname.endsWith(`/source-${generation}`))) {
      await this.call(['snapshot', 'delete', this.name(id), `source-${generation}`])
    }
    await this.call(['snapshot', 'create', this.name(id), `source-${generation}`])
  }

  /** Remove superseded guest snapshots after the source owner durably acknowledges a generation.
   * @param id - retained workspace identifier.
   * @param generation - durably acknowledged source checkpoint.
   */
  async prune(id: ConversationWorkspaceId, generation: number): Promise<void> {
    const snapshots = await this.json(['query', `/1.0/instances/${this.name(id)}/snapshots?project=${this.config.project}`])
    if (!Array.isArray(snapshots) || snapshots.some(value => typeof value !== 'string')) throw new Error('development-vm: invalid snapshot listing')
    for (const value of snapshots) {
      const match = /\/source-(\d+)$/u.exec(new URL(value as string, 'http://incus').pathname)
      if (match !== null && Number(match[1]) < generation - 1) await this.call(['snapshot', 'delete', this.name(id), `source-${match[1]}`])
    }
  }

  /** Stop all guest execution while retaining its durable disks.
   * @param id - retained workspace identifier.
   */
  async stop(id: ConversationWorkspaceId): Promise<void> {
    const deadline = Date.now() + this.config.timeoutMs
    for (;;) {
      try { await this.call(['stop', this.name(id), '--force']) }
      catch (error) {
        if (!(error instanceof Error) || !error.message.includes('already stopped')) throw error
      }
      const groups = object(await this.json(['query', `/1.0/operations?project=${this.config.project}&recursion=1`]))
      const pending = Object.entries(groups).some(([status, values]) => {
        if (!['running', 'pending', 'cancelling'].includes(status.toLowerCase())) return false
        if (!Array.isArray(values)) throw new Error('development-vm: invalid operation listing')
        return values.some((value) => {
          const resources = object(object(value).resources)
          return Object.values(resources).some(items => Array.isArray(items) && items.some(item =>
            typeof item === 'string' && new URL(item, 'http://incus').pathname === `/1.0/instances/${this.name(id)}`))
        })
      })
      if (!pending && await this.state(id) === 'Stopped') break
      if (Date.now() >= deadline) throw new Error('development-vm: guest shutdown did not settle')
      await delay(this.config.readinessPollMs)
    }
    this.frozen.delete(id)
  }

  /** Read hypervisor-owned state.
   * @param id - retained workspace identifier.
   * @returns Incus instance status.
   */
  async state(id: ConversationWorkspaceId): Promise<string> {
    const response = object(await this.json(['query', `/1.0/instances/${this.name(id)}/state?project=${this.config.project}`]))
    if (typeof response.status !== 'string') throw new Error('development-vm: invalid instance state')
    return response.status
  }

  /** Construct a retained name without accepting model-supplied resource selectors.
   * @param id - workspace SHA-256 prefix.
   * @returns project-local VM name.
   */
  name(id: ConversationWorkspaceId): string {
    if (!/^[a-f0-9]{32}$/u.test(id)) throw new Error('development-vm: invalid workspace identifier')
    return `dsh-${id}`
  }

  private async fenceOperation(id: ConversationWorkspaceId, action: 'freeze' | 'thaw', members?: unknown[]): Promise<unknown[]> {
    const bytes = await this.fence(['-c', VM_FILESYSTEM_FENCE], Buffer.from(JSON.stringify({
      action, devicesRoot: this.config.devicesRoot, project: this.config.project, name: this.name(id),
      timeoutMs: this.config.timeoutMs, members,
    })))
    const result: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!Array.isArray(result) || (action === 'freeze' && result.length === 0)
      || result.some((value) => { const member = object(value); return !Number.isSafeInteger(member.pid) || Number(member.pid) < 1 || typeof member.started !== 'string' || !/^\d+$/u.test(member.started) })) throw new Error('development-vm: invalid filesystem fence response')
    return result as unknown[]
  }

  private async call(argv: readonly string[]): Promise<Uint8Array> {
    const separator = argv.indexOf('--')
    const position = separator < 0 ? argv.length : separator
    return await this.run([...argv.slice(0, position), '--project', this.config.project, ...argv.slice(position)])
  }
  private async json(argv: readonly string[]): Promise<unknown> {
    const bytes = await this.run([...argv, '--raw'])
    const response = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
    if (response.type !== 'sync' || response.status_code !== 200 || response.error_code !== 0) throw new Error('development-vm: unexpected API response')
    return response.metadata
  }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('development-vm: invalid Incus response')
  return value as Record<string, unknown>
}
