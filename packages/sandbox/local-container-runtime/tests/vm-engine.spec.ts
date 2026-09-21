import { brandString } from '@deepseek-ai/dsh-brand'
import type { ConversationWorkspaceId } from '../src/workspace-types.ts'
import { describe, expect, it } from 'vitest'
import { IncusDevelopmentVms, VM_DENIED_NETWORKS, type DevelopmentVmConfig, type VmCommand } from '../src/vm-engine.ts'

const config: DevelopmentVmConfig = {
  command: '/usr/bin/incus', pythonCommand: '/usr/bin/python3', devicesRoot: '/var/lib/incus/devices', project: 'test', storage: 'test', network: 'test', acl: 'test',
  hostAddresses: ['203.0.113.1'], image: 'a'.repeat(64), maxInstances: 4, workspaceUid: 1000, workspaceGid: 1000, cpus: 2, memoryBytes: 1024, diskBytes: 4096,
  timeoutMs: 1000, readinessPollMs: 10, maxOutputBytes: 8192,
}
const id = brandString<ConversationWorkspaceId>('b'.repeat(32))
function fixture() {
  let status = 'Running'
  const calls: string[][] = []
  const network = { managed: true, type: 'bridge', config: {
    'ipv6.address': 'none', 'security.acls': 'test',
    'security.acls.default.egress.action': 'reject', 'security.acls.default.ingress.action': 'reject',
  } }
  const acl = { ingress: [], egress: [
    { action: 'drop', state: 'enabled', destination: [...VM_DENIED_NETWORKS, '203.0.113.1/32'].join(',') },
    { action: 'allow', state: 'enabled', protocol: 'tcp', destination_port: '80,443' },
  ] }
  const run: VmCommand = async (argv) => {
    calls.push([...argv])
    if (argv[0] === 'pause') status = 'Frozen'
    if (argv[0] === 'start') status = 'Running'
    if (argv[0] === 'stop') status = 'Stopped'
    const path = argv[1] ?? ''
    const response = path.startsWith('/1.0/operations?') ? {} : path.startsWith('/1.0/projects/') ? { config: { 'limits.instances': '4' } } : path.startsWith('/1.0/networks/') ? network
      : path.startsWith('/1.0/network-acls/') ? acl
        : path.includes('/snapshots?') ? [] : { status }
    return Buffer.from(JSON.stringify({ type: 'sync', status_code: 200, error_code: 0, metadata: response }))
  }
  return { engine: new IncusDevelopmentVms(config, run, async (_argv, input) => Buffer.from((JSON.parse(Buffer.from(input ?? []).toString()) as { action: string }).action === 'freeze' ? '[{"pid":123,"started":"456"}]' : '[]')), run, calls, network, acl, setStatus: (value: string) => { status = value } }
}

describe('development VM host controls', () => {
  it('accepts bounded public HTTP with explicit private and host destination drops', async () => {
    await fixture().engine.verifyNetwork()
  })
  it('rejects an omitted host address before provisioning', async () => {
    const test = fixture()
    test.acl.egress[0]!.destination = VM_DENIED_NETWORKS.join(',')
    await expect(test.engine.verifyNetwork()).rejects.toThrow('forbidden destinations')
    expect(test.calls.some(call => call[0] === 'init')).toBe(false)
  })
  it('rejects IPv6, permissive defaults, and additional broad allow rules', async () => {
    const ipv6 = fixture(); ipv6.network.config['ipv6.address'] = 'auto'
    await expect(ipv6.engine.verifyNetwork()).rejects.toThrow('isolation')
    const defaults = fixture(); defaults.network.config['security.acls.default.ingress.action'] = 'allow'
    await expect(defaults.engine.verifyNetwork()).rejects.toThrow('isolation')
    const allow = fixture(); allow.acl.egress.push({ action: 'allow', state: 'enabled', protocol: 'tcp', destination_port: '22' })
    await expect(allow.engine.verifyNetwork()).rejects.toThrow('unsupported')
  })
  it('requires an observed hypervisor freeze before snapshotting', async () => {
    const test = fixture()
    await expect(test.engine.checkpoint(id, 2)).rejects.toThrow('frozen')
    expect(test.calls.some(call => call[0] === 'snapshot')).toBe(false)
    await test.engine.freeze(id)
    await test.engine.checkpoint(id, 2)
    await test.engine.unfreeze(id)
    expect(await test.engine.state(id)).toBe('Running')
    expect(test.calls.filter(call => call[0] === 'snapshot')).toEqual([
      ['snapshot', 'create', `dsh-${id}`, 'source-2', '--project', 'test'],
    ])
  })
  it('does not mistake failed pause acknowledgement for a writer barrier', async () => {
    const test = fixture()
    const engine = new IncusDevelopmentVms(config, async argv => argv[0] === 'pause' ? Buffer.from('{}') : await test.run(argv))
    await expect(engine.freeze(id)).rejects.toThrow('writer barrier')
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
  it('rejects arbitrary instance names and unpinned images at the host boundary', () => {
    expect(() => fixture().engine.name(brandString<ConversationWorkspaceId>('../../other'))).toThrow('identifier')
    expect(() => new IncusDevelopmentVms({ ...config, image: 'images:ubuntu/24.04' })).toThrow('fingerprint')
  })
})
