/** Host-owned Incus VM lifecycle. Guest input never selects host commands or paths. @module */
import type { ConversationWorkspaceId } from './workspace-types.ts'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
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
  /** Project-local managed bridge with the required ACL. */
  network: string
  /** Project-local network ACL owned by the deployment. */
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

/** Persisted host-enforced egress policy identity. */
export interface DevelopmentVmNetworkPolicy {
  /** Descriptor schema version. */
  version: 1
  /** IPv4 uses a private RFC 1918 bridge with host NAT. */
  ipv4: 'private-rfc1918-nat'
  /** IPv6 remains unavailable on the managed bridge. */
  ipv6: 'disabled'
  /** Unmatched ingress action. */
  defaultIngress: 'reject'
  /** Unmatched egress action. */
  defaultEgress: 'reject'
  /** Public host addresses denied as exact IPv4 destinations. */
  hostAddresses: string[]
  /** Non-public IPv4 ranges denied before public egress rules. */
  deniedNetworks: string[]
  /** Public TCP destination ports admitted by the ACL. */
  publicTcpPorts: [80, 443]
  /** Exact public DNS resolver destinations admitted on UDP port 53. */
  dnsResolvers: ['1.1.1.1/32', '8.8.8.8/32']
}

/** Canonical durable identity for a compatible development VM provider. */
export interface DevelopmentVmDescriptor {
  /** Descriptor schema version. */
  version: 1
  /** Dedicated Incus project. */
  project: string
  /** Dedicated storage pool. */
  storage: string
  /** Project-local managed network. */
  network: string
  /** Project-local network ACL. */
  acl: string
  /** Immutable local image fingerprint. */
  image: string
  /** Shared-source host UID. */
  workspaceUid: number
  /** Shared-source host GID. */
  workspaceGid: number
  /** VM CPU limit. */
  cpus: number
  /** VM memory limit in bytes. */
  memoryBytes: number
  /** VM root-disk limit in bytes. */
  diskBytes: number
  /** Project instance quota. */
  maxInstances: number
  /** Complete host-enforced network policy. */
  networkPolicy: DevelopmentVmNetworkPolicy
}

/** Persisted canonical descriptor and its SHA-256 identity. */
export interface DevelopmentVmReference {
  /** Complete versioned provider descriptor. */
  descriptor: DevelopmentVmDescriptor
  /** SHA-256 of the descriptor's canonical JSON encoding. */
  fingerprint: string
}

/** Fixed command executor; tests replace the process boundary only. */
export type VmCommand = (argv: readonly string[], input?: Uint8Array) => Promise<Uint8Array>

/** Non-public destinations forbidden even when public HTTP egress is allowed. */
export const VM_DENIED_NETWORKS = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8',
  '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16',
  '198.18.0.0/15', '224.0.0.0/4', '240.0.0.0/4',
] as const

const VM_DNS_RESOLVERS = ['1.1.1.1/32', '8.8.8.8/32'] as const
const RESOURCE_NAME = /^[a-z][a-z0-9-]{0,62}$/u
const SHA256 = /^[a-f0-9]{64}$/u

/** Build the canonical persisted identity for one validated provider configuration.
 * @param config - deployment-owned provider configuration.
 * @returns immutable descriptor data and its canonical SHA-256 fingerprint.
 */
export function developmentVmReference(config: DevelopmentVmConfig): DevelopmentVmReference {
  const hostAddresses = [...config.hostAddresses].sort()
  const descriptor: DevelopmentVmDescriptor = {
    version: 1,
    project: config.project,
    storage: config.storage,
    network: config.network,
    acl: config.acl,
    image: config.image,
    workspaceUid: config.workspaceUid,
    workspaceGid: config.workspaceGid,
    cpus: config.cpus,
    memoryBytes: config.memoryBytes,
    diskBytes: config.diskBytes,
    maxInstances: config.maxInstances,
    networkPolicy: {
      version: 1,
      ipv4: 'private-rfc1918-nat',
      ipv6: 'disabled',
      defaultIngress: 'reject',
      defaultEgress: 'reject',
      hostAddresses,
      deniedNetworks: [...VM_DENIED_NETWORKS],
      publicTcpPorts: [80, 443],
      dnsResolvers: [...VM_DNS_RESOLVERS],
    },
  }
  return { descriptor, fingerprint: createHash('sha256').update(canonicalJson(descriptor)).digest('hex') }
}

/** Parse an untrusted persisted provider identity without accepting legacy string records.
 * @param value - durable JSON value.
 * @returns normalized canonical descriptor and verified fingerprint.
 */
export function parseDevelopmentVmReference(value: unknown): DevelopmentVmReference {
  if (!exactObject(value, ['descriptor', 'fingerprint']) || typeof value.fingerprint !== 'string' || !SHA256.test(value.fingerprint)) {
    throw new Error('corrupt workspace VM descriptor')
  }
  const descriptor = parseDescriptor(value.descriptor)
  const fingerprint = createHash('sha256').update(canonicalJson(descriptor)).digest('hex')
  if (value.fingerprint !== fingerprint) throw new Error('corrupt workspace VM fingerprint')
  return { descriptor, fingerprint }
}

/** Compare persisted provider identities after full boundary validation.
 * @param left - first durable identity.
 * @param right - second durable identity.
 * @returns whether both canonical descriptors are identical.
 */
export function sameDevelopmentVmReference(left: unknown, right: unknown): boolean {
  const a = parseDevelopmentVmReference(left)
  const b = parseDevelopmentVmReference(right)
  return a.fingerprint === b.fingerprint && canonicalJson(a.descriptor) === canonicalJson(b.descriptor)
}

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
    const timer = setTimeout(() => { stop(new Error('development-vm: Incus operation timed out')) }, config.timeoutMs)
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
  readonly reference: DevelopmentVmReference

  constructor(readonly config: DevelopmentVmConfig, command?: VmCommand, fence?: VmCommand) {
    if (!isAbsolute(config.command) || config.command.includes('\0')) throw new Error('development-vm: command must be absolute')
    if (!isAbsolute(config.pythonCommand) || !isAbsolute(config.devicesRoot)) throw new Error('development-vm: host controller paths must be absolute')
    for (const value of [config.project, config.storage, config.network, config.acl]) {
      if (!RESOURCE_NAME.test(value)) throw new Error('development-vm: invalid resource name')
    }
    if (!SHA256.test(config.image)) throw new Error('development-vm: image must be a local SHA-256 fingerprint')
    for (const value of [config.maxInstances, config.cpus, config.memoryBytes, config.diskBytes,
      config.timeoutMs, config.readinessPollMs, config.maxOutputBytes]) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error('development-vm: resource bounds must be positive safe integers')
    }
    if (config.timeoutMs > 2_147_483_647) throw new Error('development-vm: timeout exceeds timer range')
    if (config.hostAddresses.length === 0 || new Set(config.hostAddresses).size !== config.hostAddresses.length
      || config.hostAddresses.some(address => isIP(address) !== 4)) {
      throw new Error('development-vm: list every public IPv4 host address; IPv6 must be disabled on the bridge')
    }
    for (const value of [config.workspaceUid, config.workspaceGid]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error('development-vm: workspace identity must be unprivileged')
    }
    if (config.workspaceUid !== config.workspaceGid) throw new Error('development-vm: shared source requires matching host UID and GID')
    this.reference = developmentVmReference(config)
    this.run = command ?? incusCommand(config)
    this.fence = fence ?? hostCommand({ ...config, command: config.pythonCommand }, [])
  }

  /** Validate the project-local host-enforced network and ACL before guest use. */
  async verifyNetwork(): Promise<void> {
    const project = object(await this.json(['query', `/1.0/projects/${this.config.project}`]))
    const projectConfig = object(project.config)
    if (projectConfig['limits.instances'] !== String(this.config.maxInstances)
      || projectConfig['features.networks'] !== 'true') {
      throw new Error('development-vm: project network ownership or instance quota differs from configuration')
    }
    const network = object(await this.json(['query', this.projectPath(`/1.0/networks/${this.config.network}`)]))
    const config = object(network.config)
    if (network.type !== 'bridge' || network.managed !== true || config['ipv6.address'] !== 'none'
      || !privateBridgeAddress(config['ipv4.address']) || config['ipv4.nat'] !== 'true'
      || config['security.acls'] !== this.config.acl
      || config['security.acls.default.egress.action'] !== 'reject'
      || config['security.acls.default.ingress.action'] !== 'reject'
      || Object.keys(config).some(key => key === 'bridge.external_interfaces' || key === 'raw.dnsmasq'
        || key.includes('.routes') || (key.startsWith('ipv6.') && key !== 'ipv6.address')
        || (key.startsWith('security.acls.') && !['security.acls.default.egress.action', 'security.acls.default.ingress.action'].includes(key)))) {
      throw new Error('development-vm: managed network isolation differs from configuration')
    }
    const acl = object(await this.json(['query', this.projectPath(`/1.0/network-acls/${this.config.acl}`)]))
    if (!Array.isArray(acl.egress) || !Array.isArray(acl.ingress) || acl.ingress.length !== 0) {
      throw new Error('development-vm: unexpected network ACL')
    }
    const required = new Set<string>([...VM_DENIED_NETWORKS, ...this.config.hostAddresses.map(ip => `${ip}/32`)])
    let publicTcp = 0
    let dns = 0
    for (const raw of acl.egress) {
      const rule = aclRule(raw)
      if (rule.state !== 'enabled' || present(rule.source) || present(rule.source_port)
        || present(rule.icmp_type) || present(rule.icmp_code)) {
        throw new Error('development-vm: unexpected ACL selector')
      }
      if (rule.action === 'drop' && !present(rule.protocol) && !present(rule.destination_port) && present(rule.destination)) {
        for (const destination of list(rule.destination)) {
          if (!required.delete(destination)) throw new Error('development-vm: network ACL contains a duplicate or unsupported denied destination')
        }
      } else if (rule.action === 'allow' && rule.protocol === 'tcp' && !present(rule.destination)
        && sameSet(list(rule.destination_port), ['80', '443'])) {
        publicTcp++
      } else if (rule.action === 'allow' && rule.protocol === 'udp'
        && sameSet(list(rule.destination_port), ['53'])
        && sameSet(list(rule.destination), VM_DNS_RESOLVERS)) {
        dns++
      } else {
        throw new Error('development-vm: unsupported network ACL rule')
      }
    }
    if (required.size !== 0) throw new Error('development-vm: network ACL omits forbidden destinations')
    if (publicTcp !== 1 || dns !== 1) throw new Error('development-vm: network ACL differs from the canonical egress policy')
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
      '-c', 'boot.autostart=false', '-c', `raw.idmap=both ${this.config.workspaceUid} 0`,
      '-c', `user.dsh.owner=${id}`, '-d', `root,size=${this.config.diskBytes}`])
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

  /** Verify immutable image and owner facts before any lifecycle operation.
   * @param id - supervisor-derived workspace identifier.
   */
  async verifyIdentity(id: ConversationWorkspaceId): Promise<void> {
    this.verifyIdentityResponse(await this.instance(id), id)
  }

  /** Verify an existing instance before giving it workspace authority.
   * @param id - supervisor-derived identifier.
   * @param directory - expected sole shared source directory.
   */
  async verify(id: ConversationWorkspaceId, directory: string): Promise<void> {
    const instance = await this.instance(id)
    const { config, devices } = this.verifyIdentityResponse(instance, id)
    if (config['limits.cpu'] !== String(this.config.cpus)
      || config['limits.memory'] !== String(this.config.memoryBytes) || config['boot.autostart'] !== 'false'
      || config['raw.idmap'] !== `both ${this.config.workspaceUid} 0`
      || Object.keys(config).some(key => (key.startsWith('raw.') && key !== 'raw.idmap') || key.startsWith('security.'))
      || Object.keys(devices).sort().join(',') !== 'eth0,root,workspace') {
      throw new Error('development-vm: instance controls differ from configuration')
    }
    const root = object(devices.root); const workspace = object(devices.workspace); const nic = object(devices.eth0)
    if (!exactObject(root, ['type', 'path', 'pool', 'size'])
      || root.type !== 'disk' || root.path !== '/' || root.pool !== this.config.storage || root.size !== String(this.config.diskBytes)
      || !exactObject(workspace, ['type', 'path', 'source'])
      || workspace.type !== 'disk' || workspace.path !== '/workspace' || workspace.source !== directory
      || !exactObject(nic, ['type', 'network', 'security.mac_filtering', 'security.ipv4_filtering', 'security.ipv6_filtering'])
      || nic.type !== 'nic' || nic.network !== this.config.network
      || nic['security.mac_filtering'] !== 'true' || nic['security.ipv4_filtering'] !== 'true'
      || nic['security.ipv6_filtering'] !== 'true') {
      throw new Error('development-vm: instance devices differ from configuration')
    }
  }

  /** Determine whether the retained guest exists without treating transport failures as absence.
   * @param id - retained workspace identifier.
   * @returns whether Incus lists the exact project-local name.
   */
  async exists(id: ConversationWorkspaceId): Promise<boolean> {
    const values = await this.json(['query', this.projectPath('/1.0/instances')])
    if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) throw new Error('development-vm: invalid instance listing')
    return values.some(value => new URL(value as string, 'http://incus').pathname === `/1.0/instances/${this.name(id)}`)
  }

  /** Restore a guest disk to an acknowledged source generation while stopped.
   * @param id - retained workspace identifier.
   * @param generation - acknowledged source checkpoint generation.
   * @param checkpointHash - acknowledged source artifact SHA-256.
   * @param directory - newly leased private source directory.
   */
  async restore(id: ConversationWorkspaceId, generation: number, checkpointHash: string, directory: string): Promise<void> {
    await this.verifyIdentity(id)
    if (await this.state(id) !== 'Stopped') throw new Error('development-vm: restore requires a stopped guest')
    await this.requireCheckpoint(id, generation, checkpointHash)
    await this.call(['snapshot', 'restore', this.name(id), `source-${generation}`])
    await this.call(['config', 'device', 'set', this.name(id), 'workspace', `source=${directory}`])
    await this.verify(id, directory)
  }

  /** Start a verified instance; await its source mount and systemd command execution.
   * @param id - retained workspace identifier.
   */
  async start(id: ConversationWorkspaceId): Promise<void> {
    await this.verifyIdentity(id)
    await this.call(['start', this.name(id)])
    const deadline = Date.now() + this.config.timeoutMs
    for (;;) {
      try {
        await this.call(['exec', this.name(id), '--', '/bin/sh', '-c',
          '/usr/bin/mountpoint -q /workspace && /usr/bin/docker info >/dev/null && /usr/bin/systemd-run --quiet --wait --collect --service-type=exec --working-directory=/workspace /bin/true || { printf "development-vm: guest toolchain not ready\\n" >&2; exit 75; }'])
        return
      } catch (error) {
        if (!(error instanceof Error) || (!error.message.includes('agent') && !error.message.includes('Instance is not running')
          && !error.message.includes('guest toolchain not ready')) || Date.now() >= deadline) throw error
        await delay(Math.min(this.config.readinessPollMs, Math.max(1, deadline - Date.now())))
      }
    }
  }

  /** Freeze every guest CPU and source-sharing helper.
   * @param id - retained workspace identifier.
   */
  async freeze(id: ConversationWorkspaceId): Promise<void> {
    await this.verifyIdentity(id)
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
    await this.verifyIdentity(id)
    if (await this.state(id) !== 'Frozen') throw new Error('development-vm: cannot release an absent writer barrier')
    const members = this.frozen.get(id)
    if (members === undefined) throw new Error('development-vm: filesystem writer barrier is absent')
    await this.fenceOperation(id, 'thaw', members)
    await this.call(['start', this.name(id)])
    this.frozen.delete(id)
    if (await this.state(id) !== 'Running') throw new Error('development-vm: guest did not resume')
  }

  /** Retain one source-paired guest disk generation without replacing an existing identity.
   * @param id - retained workspace identifier.
   * @param generation - matching source checkpoint generation.
   * @param checkpointHash - matching source artifact SHA-256.
   */
  async checkpoint(id: ConversationWorkspaceId, generation: number, checkpointHash: string): Promise<void> {
    validateCheckpoint(generation, checkpointHash)
    await this.verifyIdentity(id)
    const state = await this.state(id)
    if (state !== 'Stopped' && (state !== 'Frozen' || !this.frozen.has(id))) {
      throw new Error('development-vm: checkpoint requires a stopped or frozen guest and filesystem helper')
    }
    const existing = await this.checkpointHash(id, generation)
    if (existing !== undefined) {
      if (existing !== checkpointHash) throw new Error('development-vm: checkpoint generation identity conflict')
      return
    }
    await this.call(['snapshot', 'create', this.name(id), `source-${generation}`, '-c', `user.dsh.checkpoint=${checkpointHash}`])
    await this.requireCheckpoint(id, generation, checkpointHash)
  }

  /** Remove one unpromoted snapshot only when its source identity still matches.
   * @param id - retained workspace identifier.
   * @param generation - unpromoted source generation.
   * @param checkpointHash - source artifact identity recorded before the failed promotion.
   */
  async discard(id: ConversationWorkspaceId, generation: number, checkpointHash: string): Promise<void> {
    validateCheckpoint(generation, checkpointHash)
    await this.verifyIdentity(id)
    const state = await this.state(id)
    if (state !== 'Stopped' && (state !== 'Frozen' || !this.frozen.has(id))) {
      throw new Error('development-vm: discard requires a stopped or frozen guest and filesystem helper')
    }
    const existing = await this.checkpointHash(id, generation)
    if (existing === undefined) return
    if (existing !== checkpointHash) throw new Error('development-vm: abandoned checkpoint identity differs from its journal')
    await this.call(['snapshot', 'delete', this.name(id), `source-${generation}`])
  }

  /** Remove superseded guest snapshots after source-manifest promotion.
   * @param id - retained workspace identifier.
   * @param generation - durably acknowledged source checkpoint.
   */
  async prune(id: ConversationWorkspaceId, generation: number): Promise<void> {
    await this.verifyIdentity(id)
    const snapshots = await this.snapshotNames(id)
    for (const value of snapshots) {
      const match = /\/source-(\d+)$/u.exec(new URL(value, 'http://incus').pathname)
      if (match !== null && Number(match[1]) < generation - 1) {
        await this.call(['snapshot', 'delete', this.name(id), `source-${match[1]}`])
      }
    }
  }

  /** Stop all guest execution while retaining its durable disks.
   * @param id - retained workspace identifier.
   */
  async stop(id: ConversationWorkspaceId): Promise<void> {
    await this.verifyIdentity(id)
    const deadline = Date.now() + this.config.timeoutMs
    for (;;) {
      try { await this.call(['stop', this.name(id), '--force']) }
      catch (error) {
        if (!(error instanceof Error) || !error.message.includes('already stopped')) throw error
      }
      const groups = object(await this.json(['query', this.projectPath('/1.0/operations?recursion=1', true)]))
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
    const response = object(await this.json(['query', this.projectPath(`/1.0/instances/${this.name(id)}/state`)]))
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

  private async instance(id: ConversationWorkspaceId): Promise<Record<string, unknown>> {
    return object(await this.json(['query', this.projectPath(`/1.0/instances/${this.name(id)}`)]))
  }

  private verifyIdentityResponse(instance: Record<string, unknown>, id: ConversationWorkspaceId): {
    config: Record<string, unknown>; devices: Record<string, unknown>
  } {
    const localConfig = object(instance.config)
    const config = object(instance.expanded_config)
    const devices = object(instance.expanded_devices)
    if (instance.type !== 'virtual-machine' || instance.name !== this.name(id)
      || (instance.project !== undefined && instance.project !== this.config.project)
      || !Array.isArray(instance.profiles) || instance.profiles.length !== 0
      || localConfig['volatile.base_image'] !== this.config.image
      || config['user.dsh.owner'] !== id) {
      throw new Error('development-vm: live image or owner identity differs from configuration')
    }
    return { config, devices }
  }

  private async snapshotNames(id: ConversationWorkspaceId): Promise<string[]> {
    const values = await this.json(['query', this.projectPath(`/1.0/instances/${this.name(id)}/snapshots`)])
    if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) throw new Error('development-vm: invalid snapshot listing')
    return values as string[]
  }

  private async checkpointHash(id: ConversationWorkspaceId, generation: number): Promise<string | undefined> {
    const path = `/1.0/instances/${this.name(id)}/snapshots/source-${generation}`
    const exists = (await this.snapshotNames(id)).some(value => new URL(value, 'http://incus').pathname === path)
    if (!exists) return undefined
    const snapshot = object(await this.json(['query', this.projectPath(path)]))
    const config = object(snapshot.config)
    const value = config['user.dsh.checkpoint']
    if (typeof value !== 'string' || !SHA256.test(value)) throw new Error('development-vm: snapshot omits its source artifact identity')
    return value
  }

  private async requireCheckpoint(id: ConversationWorkspaceId, generation: number, checkpointHash: string): Promise<void> {
    validateCheckpoint(generation, checkpointHash)
    if (await this.checkpointHash(id, generation) !== checkpointHash) {
      throw new Error('development-vm: paired guest checkpoint is missing or differs from source recovery')
    }
  }

  private async fenceOperation(id: ConversationWorkspaceId, action: 'freeze' | 'thaw', members?: unknown[]): Promise<unknown[]> {
    const bytes = await this.fence(['-c', VM_FILESYSTEM_FENCE], Buffer.from(JSON.stringify({
      action, devicesRoot: this.config.devicesRoot, project: this.config.project, name: this.name(id),
      timeoutMs: this.config.timeoutMs, members,
    })))
    const result: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!Array.isArray(result) || (action === 'freeze' && result.length === 0)
      || result.some((value) => { const member = object(value); return !Number.isSafeInteger(member.pid) || Number(member.pid) < 1 || typeof member.started !== 'string' || !/^\d+$/u.test(member.started) })) {
      throw new Error('development-vm: invalid filesystem fence response')
    }
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

  private projectPath(path: string, hasQuery = false): string {
    return `${path}${hasQuery ? '&' : '?'}project=${this.config.project}`
  }
}

function parseDescriptor(value: unknown): DevelopmentVmDescriptor {
  const keys = ['version', 'project', 'storage', 'network', 'acl', 'image', 'workspaceUid', 'workspaceGid',
    'cpus', 'memoryBytes', 'diskBytes', 'maxInstances', 'networkPolicy']
  if (!exactObject(value, keys) || value.version !== 1) throw new Error('corrupt workspace VM descriptor')
  for (const key of ['project', 'storage', 'network', 'acl'] as const) {
    if (typeof value[key] !== 'string' || !RESOURCE_NAME.test(value[key])) throw new Error('corrupt workspace VM descriptor')
  }
  if (typeof value.image !== 'string' || !SHA256.test(value.image)) throw new Error('corrupt workspace VM descriptor')
  for (const key of ['workspaceUid', 'workspaceGid', 'cpus', 'memoryBytes', 'diskBytes', 'maxInstances'] as const) {
    if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 1) throw new Error('corrupt workspace VM descriptor')
  }
  const policy = value.networkPolicy
  const policyKeys = ['version', 'ipv4', 'ipv6', 'defaultIngress', 'defaultEgress', 'hostAddresses', 'deniedNetworks', 'publicTcpPorts', 'dnsResolvers']
  if (!exactObject(policy, policyKeys) || policy.version !== 1 || policy.ipv4 !== 'private-rfc1918-nat' || policy.ipv6 !== 'disabled'
    || policy.defaultIngress !== 'reject' || policy.defaultEgress !== 'reject'
    || !Array.isArray(policy.hostAddresses) || policy.hostAddresses.length === 0
    || policy.hostAddresses.some(address => typeof address !== 'string' || isIP(address) !== 4)
    || new Set(policy.hostAddresses).size !== policy.hostAddresses.length
    || !sameValues(policy.hostAddresses, [...policy.hostAddresses].sort())
    || !sameValues(policy.deniedNetworks, VM_DENIED_NETWORKS)
    || !sameValues(policy.publicTcpPorts, [80, 443])
    || !sameValues(policy.dnsResolvers, VM_DNS_RESOLVERS)) {
    throw new Error('corrupt workspace VM network policy')
  }
  return value as unknown as DevelopmentVmDescriptor
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && sameSet(Object.keys(value as Record<string, unknown>), keys)
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('development-vm: invalid Incus response')
  return value as Record<string, unknown>
}

function aclRule(value: unknown): Record<string, unknown> {
  const rule = object(value)
  const fields = new Set(['action', 'state', 'source', 'destination', 'protocol', 'source_port', 'destination_port', 'icmp_type', 'icmp_code', 'description'])
  if (Object.keys(rule).some(key => !fields.has(key))) throw new Error('development-vm: unsupported network ACL field')
  for (const field of Object.values(rule)) if (typeof field !== 'string') throw new Error('development-vm: invalid network ACL field')
  return rule
}

function privateBridgeAddress(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/u.exec(value)
  if (match === null || match.slice(1).some(part => !Number.isSafeInteger(Number(part)))) return false
  const [first, second, third, fourth, prefix] = match.slice(1).map(Number) as [number, number, number, number, number]
  if ([first, second, third, fourth].some(part => part < 0 || part > 255) || prefix < 8 || prefix > 30) return false
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)
}

function present(value: unknown): value is string { return typeof value === 'string' && value.length > 0 }
function list(value: unknown): string[] {
  if (!present(value)) return []
  const values = value.split(',').map(item => item.trim())
  if (values.some(item => item.length === 0) || new Set(values).size !== values.length) throw new Error('development-vm: invalid network ACL list')
  return values
}
function sameSet(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && new Set(left).size === left.length && left.every(value => right.includes(value))
}
function sameValues(left: unknown, right: readonly unknown[]): boolean {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index])
}
function validateCheckpoint(generation: number, checkpointHash: string): void {
  if (!Number.isSafeInteger(generation) || generation < 1 || !SHA256.test(checkpointHash)) {
    throw new Error('development-vm: invalid checkpoint identity')
  }
}
