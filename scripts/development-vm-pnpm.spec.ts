/** Linux provisioning-template coverage with isolated paths and Corepack effects. @module */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'

interface ProvisioningTemplate {
  write_files: Array<{ path: string; owner: string; permissions: string; content: string }>
  runcmd: string[][]
}

const template = load(readFileSync(new URL('./development-vm-pnpm.cloud-init.yaml', import.meta.url), 'utf8')) as ProvisioningTemplate
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pnpm-provision-'))
  roots.push(root)
  const bin = join(root, 'bin')
  mkdirSync(bin)
  const script = join(root, 'provision.sh')
  writeFileSync(script, template.write_files[0]!.content)
  writeFileSync(join(bin, 'findmnt'), '#!/bin/sh\nprintf "%s\\n" "${TEST_FSTYPE:-ext4}"\n', { mode: 0o755 })
  writeFileSync(join(bin, 'corepack'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_LOG"\nexit "${TEST_COREPACK_STATUS:-0}"\n', { mode: 0o755 })
  const cache = join(root, 'cache')
  const store = join(root, 'home', 'store')
  const log = join(root, 'corepack.log')
  const run = (storePath = store, cachePath = cache, extra: Record<string, string> = {}) => spawnSync('/bin/sh', [script, storePath, cachePath], {
    env: { ...process.env, HOME: join(root, 'home'), XDG_CONFIG_HOME: join(root, 'config'), PATH: `${bin}:${process.env.PATH}`, TEST_LOG: log, ...extra },
    encoding: 'utf8',
    timeout: 30000,
  })
  return { root, cache, store, log, run }
}

function expectExit(result: ReturnType<typeof spawnSync>, status: number) {
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.status, String(result.stderr)).toBe(status)
}

it('installs the guarded provisioning script before running it as root', () => {
  expect(template.write_files).toHaveLength(1)
  expect(template.write_files[0]).toMatchObject({ path: '/usr/local/sbin/dsh-provision-pnpm-store', owner: 'root:root', permissions: '0755' })
  expect(template.runcmd).toEqual([['sh', '-c', 'cd /root && /usr/local/sbin/dsh-provision-pnpm-store']])
  expect(template.write_files[0]!.content).toContain('store_dir=${1:-/home/carlo/.local/share/pnpm/store}')
  expect(template.write_files[0]!.content).toContain('cache_dir=${2:-/var/cache/pnpm-store}')
})

// The guest toolchain and ext4 mount check are Linux-only; each fixture owns its shell paths.
describe.skipIf(process.platform !== 'linux')('development VM pnpm provisioning', () => {
  it('keeps cache contents and the compatible store link across repeated provisioning', () => {
    const f = fixture()
    mkdirSync(f.cache)
    writeFileSync(join(f.cache, 'retained'), 'cached package')
    expectExit(f.run(), 0)
    expectExit(f.run(), 0)
    expect(readlinkSync(f.store)).toBe(f.cache)
    expect(readFileSync(join(f.cache, 'retained'), 'utf8')).toBe('cached package')
    expect(readdirSync(f.cache)).toEqual(['retained'])
    expect(readFileSync(f.log, 'utf8').trim().split('\n')).toEqual([
      'enable', `pnpm@11.7.0 config set --global storeDir ${f.store}`,
      'enable', `pnpm@11.7.0 config set --global storeDir ${f.store}`,
    ])
  })

  it('rejects virtiofs before linking the store or configuring Corepack', () => {
    const f = fixture()
    const result = f.run(f.store, f.cache, { TEST_FSTYPE: 'virtiofs' })
    expectExit(result, 1)
    expect(result.stderr).toContain('pnpm cache must be on guest ext4')
    expect(readdirSync(f.root).sort()).toEqual(['bin', 'cache', 'provision.sh'])
  })

  it('leaves a conflicting existing store directory untouched', () => {
    const f = fixture()
    mkdirSync(f.store, { recursive: true })
    writeFileSync(join(f.store, 'retained'), 'existing store')
    const result = f.run()
    expectExit(result, 1)
    expect(result.stderr).toContain('migrate it explicitly')
    expect(readFileSync(join(f.store, 'retained'), 'utf8')).toBe('existing store')
    expect(readdirSync(f.root)).not.toContain('corepack.log')
  })

  it('leaves a conflicting symlink and its target untouched', () => {
    const f = fixture()
    mkdirSync(join(f.root, 'home'))
    const other = join(f.root, 'another-cache')
    mkdirSync(other)
    writeFileSync(join(other, 'retained'), 'other store')
    symlinkSync(other, f.store)
    const result = f.run()
    expectExit(result, 1)
    expect(result.stderr).toContain('targets another directory')
    expect(readlinkSync(f.store)).toBe(other)
    expect(readFileSync(join(other, 'retained'), 'utf8')).toBe('other store')
    expect(readdirSync(f.root)).not.toContain('corepack.log')
  })

  it('reports Corepack failure without deleting cached data', () => {
    const f = fixture()
    mkdirSync(f.cache)
    writeFileSync(join(f.cache, 'retained'), 'cached package')
    expectExit(f.run(f.store, f.cache, { TEST_COREPACK_STATUS: '17' }), 17)
    expect(readFileSync(join(f.cache, 'retained'), 'utf8')).toBe('cached package')
    expect(readFileSync(f.log, 'utf8')).toBe('enable\n')
  })

  it.each([['relative-store', '/unused-cache'], ['/unused-store', 'relative-cache']])('rejects relative paths before filesystem writes (%s, %s)', (store, cache) => {
    const f = fixture()
    expectExit(f.run(store, cache), 1)
    expect(readdirSync(f.root).sort()).toEqual(['bin', 'provision.sh'])
  })
})
