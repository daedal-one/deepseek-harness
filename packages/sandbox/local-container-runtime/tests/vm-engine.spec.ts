import { brandString } from '@deepseek-ai/dsh-brand'
import type { ConversationWorkspaceId } from '../src/workspace-types.ts'
import { describe, expect, it } from 'vitest'
import {
  developmentVmReference,
  IncusDevelopmentVms,
  parseDevelopmentVmReference,
  VM_DENIED_NETWORKS,
  type DevelopmentVmConfig,
  type VmCommand,
} from '../src/vm-engine.ts'

const config: DevelopmentVmConfig = {
  command: '/usr/bin/incus', pythonCommand: '/usr/bin/python3', devicesRoot: '/var/lib/incus/devices', project: 'test', storage: 'test', network: 'test', acl: 'test',
  hostAddresses: ['203.0.113.1'], image: 'a'.repeat(64), maxInstances: 4, workspaceUid: 1000, workspaceGid: 1000, cpus: 2, memoryBytes: 1024, diskBytes: 4096,
  timeoutMs: 1000, readinessPollMs: 10, maxOutputBytes: 8192,
}
const id = brandString<ConversationWorkspaceId>('b'.repeat(32))

function fixture() {
  let status = 'Running'
  const calls: string[][] = []
  const snapshots = new Map<number, string>()
  const network: { managed: boolean; type: string; config: Record<string, string> } = { managed: true, type: 'bridge', config: {
    'ipv4.address': '10.210.0.1/24', 'ipv4.nat': 'true', 'ipv6.address': 'none', 'security.acls': 'test',
    'security.acls.default.egress.action': 'reject', 'security.acls.default.ingress.action': 'reject',
  } }
  const acl = { ingress: [], egress: [
    { action: 'drop', state: 'enabled', destination: [...VM_DENIED_NETWORKS, '203.0.113.1/32'].join(',') },
    { action: 'allow', state: 'enabled', protocol: 'tcp', destination_port: '80,443' },
    { action: 'allow', state: 'enabled', protocol: 'udp', destination: '1.1.1.1/32,8.8.8.8/32', destination_port: '53' },
  ] }
  const instance = { name: `dsh-${id}`, project: 'test', type: 'virtual-machine', profiles: [],
    config: { 'volatile.base_image': config.image },
    expanded_config: { 'user.dsh.owner': id, 'limits.cpu': '2', 'limits.memory': '1024', 'boot.autostart': 'false', 'raw.idmap': 'both 1000 0' },
    expanded_devices: { root: { type: 'disk', path: '/', pool: 'test', size: '4096' },
      workspace: { type: 'disk', path: '/workspace', source: '/private/source' },
      eth0: { type: 'nic', network: 'test', 'security.mac_filtering': 'true', 'security.ipv4_filtering': 'true', 'security.ipv6_filtering': 'true' } } }
  const run: VmCommand = async (argv) => {
    calls.push([...argv])
    if (argv[0] === 'pause') status = 'Frozen'
    if (argv[0] === 'start') status = 'Running'
    if (argv[0] === 'stop') status = 'Stopped'
    if (argv[0] === 'snapshot' && argv[1] === 'create') {
      const generation = Number(argv[3]?.slice('source-'.length))
      const label = argv.find(value => value.startsWith('user.dsh.checkpoint='))?.slice('user.dsh.checkpoint='.length)
      if (label !== undefined) snapshots.set(generation, label)
    }
    if (argv[0] === 'snapshot' && argv[1] === 'delete') snapshots.delete(Number(argv[3]?.slice('source-'.length)))
    const rawPath = argv[1] ?? ''
    const path = rawPath.split('?')[0]!
    let response: unknown
    if (path === '/1.0/projects/test') response = { config: { 'limits.instances': '4', 'features.networks': 'true' } }
    else if (path === '/1.0/networks/test') response = network
    else if (path === '/1.0/network-acls/test') response = acl
    else if (path === `/1.0/instances/dsh-${id}/state`) response = { status }
    else if (path === `/1.0/instances/dsh-${id}/snapshots`) response = [...snapshots.keys()].map(generation => `/1.0/instances/dsh-${id}/snapshots/source-${generation}`)
    else if (path.startsWith(`/1.0/instances/dsh-${id}/snapshots/source-`)) {
      const generation = Number(path.slice(path.lastIndexOf('source-') + 'source-'.length))
      response = { config: { 'user.dsh.checkpoint': snapshots.get(generation) } }
    } else if (path === `/1.0/instances/dsh-${id}`) response = instance
    else if (path === '/1.0/instances') response = [`/1.0/instances/dsh-${id}`]
    else if (path === '/1.0/operations') response = {}
    else response = {}
    return Buffer.from(JSON.stringify({ type: 'sync', status_code: 200, error_code: 0, metadata: response }))
  }
  return {
    engine: new IncusDevelopmentVms(config, run, async (_argv, input) => Buffer.from((JSON.parse(Buffer.from(input ?? []).toString()) as { action: string }).action === 'freeze' ? '[{"pid":123,"started":"456"}]' : '[]')),
    run, calls, network, acl, instance, snapshots, setStatus: (value: string) => { status = value },
  }
}

describe('development VM host controls', () => {
  it('queries both the managed network and ACL in the configured project', async () => {
    const test = fixture()
    await test.engine.verifyNetwork()
    expect(test.calls).toContainEqual(['query', '/1.0/networks/test?project=test', '--raw'])
    expect(test.calls).toContainEqual(['query', '/1.0/network-acls/test?project=test', '--raw'])
  })

  it('accepts only the canonical public HTTP, HTTPS, and DNS egress policy', async () => {
    await fixture().engine.verifyNetwork()
    const missingDns = fixture(); missingDns.acl.egress.pop()
    await expect(missingDns.engine.verifyNetwork()).rejects.toThrow('canonical egress policy')
  })

  it('rejects an omitted host address before provisioning', async () => {
    const test = fixture()
    test.acl.egress[0]!.destination = VM_DENIED_NETWORKS.join(',')
    await expect(test.engine.verifyNetwork()).rejects.toThrow('forbidden destinations')
    expect(test.calls.some(call => call[0] === 'init')).toBe(false)
  })

  it('rejects inherited project networks, IPv6, permissive defaults, and broad allow rules', async () => {
    const inherited = fixture()
    const original = inherited.run
    const engine = new IncusDevelopmentVms(config, async (argv, input) => {
      if (argv[1] === '/1.0/projects/test') return Buffer.from(JSON.stringify({ type: 'sync', status_code: 200, error_code: 0, metadata: { config: { 'limits.instances': '4', 'features.networks': 'false' } } }))
      return await original(argv, input)
    })
    await expect(engine.verifyNetwork()).rejects.toThrow('project network ownership')
    const ipv6 = fixture(); ipv6.network.config['ipv6.address'] = 'auto'
    await expect(ipv6.engine.verifyNetwork()).rejects.toThrow('isolation')
    const defaults = fixture(); defaults.network.config['security.acls.default.ingress.action'] = 'allow'
    await expect(defaults.engine.verifyNetwork()).rejects.toThrow('isolation')
    const routed = fixture(); routed.network.config['ipv4.routes'] = '203.0.113.0/24'
    await expect(routed.engine.verifyNetwork()).rejects.toThrow('isolation')
    const allow = fixture(); allow.acl.egress.push({ action: 'allow', state: 'enabled', protocol: 'tcp', destination_port: '22' })
    await expect(allow.engine.verifyNetwork()).rejects.toThrow('unsupported')
  })

  it('requires an observed hypervisor freeze before snapshotting and reuses an identical snapshot', async () => {
    const test = fixture()
    const hash = 'c'.repeat(64)
    await expect(test.engine.checkpoint(id, 2, hash)).rejects.toThrow('frozen')
    expect(test.calls.some(call => call[0] === 'snapshot')).toBe(false)
    await test.engine.freeze(id)
    await test.engine.checkpoint(id, 2, hash)
    await test.engine.checkpoint(id, 2, hash)
    await test.engine.unfreeze(id)
    expect(await test.engine.state(id)).toBe('Running')
    expect(test.calls.filter(call => call[0] === 'snapshot' && call[1] === 'create')).toEqual([
      ['snapshot', 'create', `dsh-${id}`, 'source-2', '-c', `user.dsh.checkpoint=${hash}`, '--project', 'test'],
    ])
  })

  it('rejects a generation already paired with another source artifact', async () => {
    const test = fixture(); test.snapshots.set(2, 'd'.repeat(64)); await test.engine.freeze(id)
    await expect(test.engine.checkpoint(id, 2, 'c'.repeat(64))).rejects.toThrow('identity conflict')
  })

  it('discards only the exact unpromoted snapshot identity while stopped', async () => {
    const test = fixture(); const hash = 'c'.repeat(64)
    test.snapshots.set(2, hash); test.setStatus('Stopped')
    await expect(test.engine.discard(id, 2, 'd'.repeat(64))).rejects.toThrow('differs')
    expect(test.snapshots.get(2)).toBe(hash)
    await test.engine.discard(id, 2, hash)
    expect(test.snapshots.has(2)).toBe(false)
  })

  it('does not mistake failed pause acknowledgement for a writer barrier', async () => {
    const test = fixture()
    const engine = new IncusDevelopmentVms(config, async argv => argv[0] === 'pause' ? Buffer.from('{}') : await test.run(argv), async () => Buffer.from('[{"pid":123,"started":"456"}]'))
    await expect(engine.freeze(id)).rejects.toThrow()
  })

  it('flushes completed guest writes before pausing and does not save a failed flush', async () => {
    const test = fixture()
    await test.engine.freeze(id)
    expect(test.calls.findIndex(call => call.includes('/bin/sync'))).toBeLessThan(test.calls.findIndex(call => call[0] === 'pause'))
    const failed = fixture()
    const engine = new IncusDevelopmentVms(config, async (argv) => {
      if (argv.includes('/bin/sync')) throw new Error('guest flush failed')
      return await failed.run(argv)
    })
    await expect(engine.freeze(id)).rejects.toThrow('flush failed')
    expect(failed.calls.some(call => call[0] === 'pause' || call[0] === 'snapshot')).toBe(false)
  })

  it('waits through the image first-boot reboot until guest execution is available', async () => {
    const test = fixture(); let attempts = 0
    const engine = new IncusDevelopmentVms(config, async (argv) => {
      if (argv[0] === 'exec') {
        attempts++
        if (attempts === 1) throw new Error('agent is not running')
        if (attempts === 2) throw new Error('Instance is not running')
        if (attempts === 3) throw new Error('guest toolchain not ready')
      }
      return await test.run(argv)
    })
    await engine.start(id)
    expect(attempts).toBe(4)
  })

  it('does not release a stopped guest while a queued reboot can restart it', async () => {
    const test = fixture(); let queries = 0
    const engine = new IncusDevelopmentVms(config, async (argv) => {
      if (argv[1]?.startsWith('/1.0/operations?') && queries++ === 0) return Buffer.from(JSON.stringify({
        type: 'sync', status_code: 200, error_code: 0,
        metadata: { running: [{ resources: { instances: [`/1.0/instances/dsh-${id}`] } }] },
      }))
      return await test.run(argv)
    })
    await engine.stop(id)
    expect(test.calls.filter(call => call[0] === 'stop')).toHaveLength(2)
    expect(await engine.state(id)).toBe('Stopped')
  })

  it('rejects live image and owner label drift before lifecycle operations', async () => {
    const image = fixture(); image.instance.config['volatile.base_image'] = 'd'.repeat(64)
    await expect(image.engine.stop(id)).rejects.toThrow('live image or owner')
    const owner = fixture(); owner.instance.expanded_config['user.dsh.owner'] = 'c'.repeat(32)
    await expect(owner.engine.stop(id)).rejects.toThrow('live image or owner')
  })

  it('rejects undeclared live device authority', async () => {
    const test = fixture()
    Object.assign(test.instance.expanded_devices.workspace, { recursive: 'true' })
    await expect(test.engine.verify(id, '/private/source')).rejects.toThrow('devices')
  })

  it('persists a canonical versioned descriptor and rejects legacy string records', () => {
    const reference = developmentVmReference(config)
    expect(parseDevelopmentVmReference(JSON.parse(JSON.stringify(reference)))).toEqual(reference)
    expect(reference.descriptor).toMatchObject({ version: 1, project: 'test', storage: 'test', network: 'test', acl: 'test',
      image: config.image, workspaceUid: 1000, workspaceGid: 1000, cpus: 2, memoryBytes: 1024, diskBytes: 4096, maxInstances: 4,
      networkPolicy: { version: 1, ipv4: 'private-rfc1918-nat', hostAddresses: ['203.0.113.1'] } })
    expect(() => parseDevelopmentVmReference('test/test')).toThrow('descriptor')
    expect(developmentVmReference({ ...config, cpus: 3 }).fingerprint).not.toBe(reference.fingerprint)
  })

  it('rejects arbitrary instance names and unpinned images at the host boundary', () => {
    expect(() => fixture().engine.name(brandString<ConversationWorkspaceId>('../../other'))).toThrow('identifier')
    expect(() => new IncusDevelopmentVms({ ...config, image: 'images:ubuntu/24.04' })).toThrow('fingerprint')
  })
})
