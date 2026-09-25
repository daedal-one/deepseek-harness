import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentAccess } from '../src/environment-access.ts'
import type { EnvironmentAccessConfig, EnvironmentAccessRecord } from '../src/environment-types.ts'
import { gitAuthorization } from '../src/git-authorization.ts'

vi.mock('../src/git-authorization.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/git-authorization.ts')>(),
  gitAuthorization: vi.fn(),
}))

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks(); vi.mocked(gitAuthorization).mockReset()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-environment-access-')); roots.push(directory)
  const config: EnvironmentAccessConfig = { id: 'environment-a', name: 'Environment A', grantLifetimeMs: 3_600_000,
    repositories: ['first', 'second'].map(name => ({ source: `/sources/${name}`, url: `https://github.example/org/${name}.git`,
      credentialTimeoutMs: 1000, fetchCredentialCommand: '/usr/local/bin/fetch-credential', pushCredentialCommand: '/usr/local/bin/push-credential' })),
    initialGrants: [{ repository: 'https://github.example/org/first.git', access: 'fetch' }] }
  const access = await EnvironmentAccess.open(config, directory, 8192)
  return { directory, config, access }
}
const approval = { kind: 'user', sessionId: 'session-a', questionId: 'question-a', reason: 'Read required source.' } as const

describe('environment repository authority', () => {
  it('persists an approved grant and does not restore revoked initial authority on restart', async () => {
    const f = await fixture()
    const repository = f.config.repositories[1]!.url
    await f.access.approve(repository, 'fetch', approval, f.access.revision, new AbortController().signal)
    await f.access.revoke(f.config.repositories[0]!.url, f.access.revision)
    const resumed = await EnvironmentAccess.open(f.config, f.directory, 8192)
    expect(resumed.grant(repository, 'fetch')?.approval).toEqual(approval)
    expect(resumed.grant(repository, 'push')).toBeUndefined()
    expect(resumed.grant(f.config.repositories[0]!.url, 'fetch')).toBeUndefined()
    expect(resumed.revision).toBe(3)
  })

  it('retains escalation and revocation decisions and verifies superseded approvals on restart', async () => {
    const f = await fixture()
    const [first, second] = f.config.repositories
    if (first === undefined || second === undefined) throw new Error('fixture repositories missing')
    await f.access.approve(second.url, 'fetch', approval, f.access.revision, new AbortController().signal)
    await f.access.approve(first.url, 'push', approval, f.access.revision, new AbortController().signal)
    const resumed = await EnvironmentAccess.open(f.config, f.directory, 8192)
    expect(resumed.grant(first.url, 'push')?.revision).toBe(3)
    const path = join(f.directory, 'environment-access.json')
    const record = JSON.parse(await readFile(path, 'utf8')) as { history: Array<{ grant: { approval: { kind: string } } }> }
    expect(record.history).toHaveLength(3)
    record.history[0]!.grant.approval.kind = 'automatic-policy'
    await writeFile(path, JSON.stringify(record))
    await expect(EnvironmentAccess.open(f.config, f.directory, 8192)).rejects.toThrow('invalid environment repository grant')
  })

  it('rejects a stale approval and an aborted approval without changing durable grants', async () => {
    const f = await fixture()
    const revision = f.access.revision
    await f.access.revoke(f.config.repositories[0]!.url, revision)
    const path = join(f.directory, 'environment-access.json')
    const before = await readFile(path)
    await expect(f.access.approve(f.config.repositories[1]!.url, 'push', approval, revision, new AbortController().signal)).rejects.toThrow('changed')
    await expect(f.access.approve(f.config.repositories[1]!.url, 'fetch', approval, f.access.revision, AbortSignal.abort())).rejects.toThrow()
    expect(await readFile(path)).toEqual(before)
  })

  it('scopes credentials to each granted repository and operation, including escalation', async () => {
    const f = await fixture()
    vi.mocked(gitAuthorization).mockImplementation(remote => async () => ['GIT_CONFIG_COUNT=2', `GIT_CONFIG_KEY_0=http.${remote.url}/.extraHeader`,
      `GIT_CONFIG_VALUE_0=Authorization: ${remote.credentialCommand}`, 'GIT_CONFIG_KEY_1=credential.helper', 'GIT_CONFIG_VALUE_1='])
    await f.access.approve(f.config.repositories[1]!.url, 'push', approval, f.access.revision, new AbortController().signal)
    const environment = await f.access.authorize()
    expect(environment).toContain('GIT_CONFIG_COUNT=3')
    expect(environment).toContain('GIT_CONFIG_VALUE_1=Authorization: /usr/local/bin/fetch-credential')
    expect(environment).toContain('GIT_CONFIG_VALUE_2=Authorization: /usr/local/bin/push-credential')
    expect(vi.mocked(gitAuthorization).mock.calls.map(([remote]) => remote.url))
      .toEqual(f.config.repositories.map(repository => repository.url))
    expect(await readFile(join(f.directory, 'environment-access.json'), 'utf8')).not.toContain('credential')
  })

  it('discards credential responses that complete after revocation', async () => {
    const f = await fixture()
    let complete!: (environment: string[]) => void
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    vi.mocked(gitAuthorization).mockImplementation(() => () => { started(); return new Promise((resolve) => { complete = resolve }) })
    const pending = f.access.authorize()
    const rejection = expect(pending).rejects.toThrow('changed during credential issuance')
    await ready
    await f.access.revoke(f.config.repositories[0]!.url, f.access.revision)
    complete(['GIT_CONFIG_KEY_0=http.example.extraHeader', 'GIT_CONFIG_VALUE_0=secret'])
    await rejection
    expect(await f.access.authorize()).toEqual(['GIT_CONFIG_COUNT=1', 'GIT_CONFIG_KEY_0=credential.helper', 'GIT_CONFIG_VALUE_0='])
  })

  it('expires grants without invoking the credential issuer', async () => {
    const f = await fixture()
    const expires = f.access.grant(f.config.repositories[0]!.url, 'fetch')!.expiresAt
    vi.spyOn(Date, 'now').mockReturnValue(expires)
    expect(f.access.grant(f.config.repositories[0]!.url, 'fetch')).toBeUndefined()
    expect(await f.access.authorize()).toHaveLength(3)
    expect(gitAuthorization).not.toHaveBeenCalled()
    expect(JSON.parse(f.access.guidance())).toMatchObject({ repositories: [] })
  })

  it('reuses valid cached issuance and rejects unknown repositories and stale revocations', async () => {
    const f = await fixture()
    vi.mocked(gitAuthorization).mockImplementation(() => async () => ['GIT_CONFIG_KEY_0=http.repo.extraHeader', 'GIT_CONFIG_VALUE_0=credential'])
    expect(await f.access.authorize()).toEqual(await f.access.authorize())
    expect(gitAuthorization).toHaveBeenCalledTimes(1)
    expect(() => f.access.repository('https://github.example/unknown/repo.git')).toThrow('catalog')
    await expect(f.access.revoke(f.config.repositories[0]!.url, 0)).rejects.toThrow('changed before revocation')
    await f.access.approve(f.config.repositories[1]!.url, 'push', approval, f.access.revision, new AbortController().signal)
    vi.mocked(gitAuthorization).mockImplementation(() => async () => [])
    await expect(f.access.authorize()).rejects.toThrow('no URL-scoped authorization')
  })

  it('permits granted public repository reads without issuing a credential', async () => {
    const f = await fixture()
    delete f.config.repositories[0]!.fetchCredentialCommand
    const publicAccess = await EnvironmentAccess.open(f.config, f.directory, 8192)
    expect(await publicAccess.authorize()).toEqual(['GIT_CONFIG_COUNT=1', 'GIT_CONFIG_KEY_0=credential.helper', 'GIT_CONFIG_VALUE_0='])
    expect(gitAuthorization).not.toHaveBeenCalled()
  })

  it.each([
    { id: '../outside' },
    { repositories: [{ source: '/source', url: 'https://github.example/org/a.git', credentialTimeoutMs: 1000, fetchCredentialCommand: '/same', pushCredentialCommand: '/same' }] },
    { initialGrants: [{ repository: 'https://github.example/outside/repo.git', access: 'fetch' as const }] },
  ])('rejects invalid environment configuration before loading authority', async (overrides) => {
    const f = await fixture()
    await expect(EnvironmentAccess.open({ ...f.config, ...overrides }, f.directory, 8192)).rejects.toThrow()
    await expect(EnvironmentAccess.open({ ...f.config, repositories: [...f.config.repositories, f.config.repositories[0]!] }, f.directory, 8192)).rejects.toThrow('unique')
  })

  it.each([
    ['wrong version', (record: EnvironmentAccessRecord) => { Reflect.set(record, 'version', 9) }],
    ['duplicate grant', (record: EnvironmentAccessRecord) => { record.grants.push(record.grants[0]!) }],
    ['non-record history entry', (record: EnvironmentAccessRecord) => { Reflect.set(record.history, 0, null) }],
    ['out-of-order decision', (record: EnvironmentAccessRecord) => { if (record.history[0]?.kind === 'grant') record.history[0].grant.revision = 2; record.revision = 2; record.history.push(record.history[0]!) }],
    ['invalid revocation', (record: EnvironmentAccessRecord) => { Reflect.set(record.history, 0, { kind: 'revoke', revision: 1, repository: record.grants[0]!.repository, revokedAt: 1, credentialsExpireBy: 2 }) }],
    ['mismatched materialization', (record: EnvironmentAccessRecord) => { record.grants = [] }],
    ['missing approval actor', (record: EnvironmentAccessRecord) => { record.grants[0]!.approval = { ...approval, questionId: '' }; record.history = [{ kind: 'grant', grant: record.grants[0]! }] }],
  ] as const)('rejects corrupted durable authority: %s', async (_name, mutate) => {
    const f = await fixture()
    const path = join(f.directory, 'environment-access.json')
    const record = JSON.parse(await readFile(path, 'utf8')) as EnvironmentAccessRecord
    mutate(record)
    await writeFile(path, JSON.stringify(record))
    await expect(EnvironmentAccess.open(f.config, f.directory, 8192)).rejects.toThrow()
  })

  it('rejects a persisted grant for a repository outside the configured environment', async () => {
    const f = await fixture()
    const path = join(f.directory, 'environment-access.json')
    const record = JSON.parse(await readFile(path, 'utf8')) as { grants: Array<{ repository: string }> }
    record.grants[0]!.repository = 'https://github.example/other/private.git'
    await writeFile(path, JSON.stringify(record))
    await expect(EnvironmentAccess.open(f.config, f.directory, 8192)).rejects.toThrow('invalid environment repository grant')
  })
})


it('persists approval for a remote outside the catalog and selects credentials only by exact provider origin', async () => {
  const f = await fixture()
  f.config.remoteRepositories = { credentialTimeoutMs: 1000, providers: [{ origin: 'https://new.example', fetchCredentialCommand: '/helpers/fetch' }] }
  const access = await EnvironmentAccess.open(f.config, f.directory, 8192)
  const remote = 'https://new.example/team/repository.git'
  const resolved = access.repository(remote)
  expect(resolved.clone).toBe(true)
  expect(resolved.source).toMatch(/repositories\/[a-f0-9]{64}$/u)
  expect(resolved.fetchCredentialCommand).toBe('/helpers/fetch')
  expect(access.repository('https://new.example.attacker.test/team/repository.git').fetchCredentialCommand).toBeUndefined()
  expect(access.repository('https://elsewhere.example/team/repository.git').pushCredentialCommand).toBeUndefined()
  await access.approve(remote, 'fetch', approval, access.revision, new AbortController().signal)
  const reopened = await EnvironmentAccess.open(f.config, f.directory, 8192)
  expect(reopened.repository(remote).source).toBe(resolved.source)
  expect(reopened.grant(remote, 'fetch')?.approval).toEqual(approval)
  expect(JSON.parse(reopened.guidance())).toMatchObject({ anyHttpsRemote: true })
  expect(() => reopened.repository('file:///host/private/repository')).toThrow()
  expect(() => reopened.repository('https://user:password@new.example/team/repo.git')).toThrow()
})
