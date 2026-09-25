import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { apply as applyRemotes } from '@deepseek-ai/dsh-api-remotes/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import * as SpendHostEntry from '@deepseek-ai/dsh-client-ui-openrouter-spend'
import { apply as applySpendClient, inject as spendClientInject } from '@deepseek-ai/dsh-client-ui-openrouter-spend/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import OpenRouterSpendService from '@deepseek-ai/dsh-openrouter-spend'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'

const roots: string[] = []
const contexts: Context[] = []

const keyBody = {
  data: {
    label: 'profile fixture key',
    usage: 1.25,
    usage_daily: 0.25,
    usage_weekly: 0.75,
    usage_monthly: 1.25,
    limit: 10,
    limit_remaining: 8.75,
    is_free_tier: false,
  },
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function keyResponse(): Response {
  return new Response(JSON.stringify(keyBody), { headers: { 'content-type': 'application/json' } })
}

async function loadProfile(credential: string | undefined): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-openrouter-spend-profile-'))
  roots.push(root)
  const profilePath = join(root, 'cordis.yml')
  await writeFile(profilePath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-session-projection'",
    "- name: '@deepseek-ai/dsh-openrouter-spend'",
    '  config:',
    '    baseURL: https://openrouter.test/api/v1',
    "- name: '@deepseek-ai/dsh-client-ui-openrouter-spend'",
    '',
  ].join('\n'))

  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('credentials', {
    resolve: async () => credential === undefined ? undefined : { value: credential },
  } as never)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-openrouter-spend', OpenRouterSpendService],
    ['@deepseek-ai/dsh-client-ui-openrouter-spend', SpendHostEntry],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected profile module: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(profilePath).href },
  })
  await ctx.loader.await()
  expect([...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
  return ctx
}

/** Declare the conversation view slot the Web contribution registers into. */
function declareConversationView(slots: SlotRegistry): void {
  slots.register({
    name: 'root',
    children: { 'conversation.view': { kind: 'list', scope: 'session' } },
  } as never, () => null)
}

describe('OpenRouter spend Web profile slice', () => {
  it('loads the host service, client roster entry, Remote contribution, and spend tab with a fake credential', async () => {
    const fetchSpy = vi.fn(() => keyResponse())
    vi.stubGlobal('fetch', fetchSpy)
    const host = await loadProfile('profile-fake-openrouter-key')
    const session = host.sessions.create(SessionId('profile-spend'))
    const service = host.get('openrouterSpend') as OpenRouterSpendService

    await expect(service.read({ sessionId: session.id }, new AbortController().signal)).resolves.toEqual({
      ok: true,
      value: expect.objectContaining({ key: expect.objectContaining({ label: 'profile fixture key' }), session: null }),
    })
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(JSON.stringify(session.snapshotEvents())).not.toContain('profile-fake-openrouter-key')
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://openrouter.test/api/v1/key')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer profile-fake-openrouter-key')

    const mounted: Array<{ readonly descriptors: readonly { readonly namespace: string }[] }> = []
    const disposeRemotes = await applyRemotes({
      remote: {
        $mount: async (contribution: { readonly descriptors: readonly { readonly namespace: string }[] }) => {
          mounted.push(contribution)
          return async () => {}
        },
      },
    } as never)
    expect(mounted.some(contribution => contribution.descriptors.some(descriptor => descriptor.namespace === 'openrouterSpend'))).toBe(true)
    await disposeRemotes()

    const client = new Context()
    contexts.push(client)
    const slotsFiber = await client.plugin(SlotRegistry)
    await slotsFiber.await()
    client.provide('locale', new LocaleRuntime(client))
    new TestRemote(client, { openrouterSpend: { read: async () => ({ ok: true, value: { ok: false, error: { reason: 'not-configured', detail: 'unused' } } }) } })
    declareConversationView(client.get('slots') as SlotRegistry)
    const clientFiber = client.plugin({ inject: [...spendClientInject], apply: applySpendClient })
    await clientFiber.await()
    expect((client.get('slots') as SlotRegistry).entries('conversation.view')).toEqual([
      expect.objectContaining({ options: expect.objectContaining({ id: 'spend', order: 20 }) }),
    ])
  })

  it('reports the profile credential-missing failure without an HTTP request', async () => {
    const fetchSpy = vi.fn(() => keyResponse())
    vi.stubGlobal('fetch', fetchSpy)
    const host = await loadProfile(undefined)
    const session = host.sessions.create(SessionId('profile-no-key'))
    const service = host.get('openrouterSpend') as OpenRouterSpendService

    await expect(service.read({ sessionId: session.id }, new AbortController().signal)).resolves.toMatchObject({
      ok: false,
      error: { reason: 'not-configured' },
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
