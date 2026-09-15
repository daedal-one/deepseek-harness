/** Native Codex refresh and Responses transport over a recovered account. */
import { createServer } from 'node:http'
import type { IncomingHttpHeaders, Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createModels } from '@earendil-works/pi-ai'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '../src/index.ts'
import { authContextFrom, credentialStoreFrom } from '../src/auth.ts'
import { catalogProvider } from '../src/catalog.ts'
import { assemble } from './assemble.ts'

let ctx: Context | undefined
let directory: string | undefined
let server: Server | undefined
afterEach(async () => {
  vi.unstubAllGlobals()
  await ctx?.fiber.dispose()
  if (server !== undefined) await new Promise<void>((resolve) => { server!.close(() => { resolve() }); server!.closeAllConnections() })
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
})

it('refreshes once across two collections and sends the recovered account through native Codex Responses', async () => {
  directory = await mkdtemp(join(tmpdir(), 'dsh-codex-recovery-'))
  ctx = new Context()
  await ctx.plugin(LocalCredentialProvider, { path: join(directory, '.credentials.yaml'), watch: false })
  const access = `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'fixture-account' } })).toString('base64url')}.signature`
  await ctx.credentials.set(credentialRef('DSH_PI_AI_OPENAI_CODEX_AUTH'), JSON.stringify({ type: 'oauth', access: 'expired', refresh: 'original-refresh', expires: 1 }))
  const requests: { path: string; headers: IncomingHttpHeaders }[] = []
  const item = { type: 'message', id: 'msg_fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Account works.', annotations: [] }] }
  const events = [
    { type: 'response.created', response: { id: 'resp_fixture' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
    { type: 'response.output_text.delta', output_index: 0, delta: 'Account works.' },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id: 'resp_fixture', status: 'completed', output: [item], usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } } },
  ]
  server = createServer((request, response) => {
    requests.push({ path: request.url!, headers: request.headers })
    request.resume()
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
  })
  await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Expected local listener')
  const endpoint = `http://127.0.0.1:${address.port}`
  const nativeFetch = globalThis.fetch
  let refreshes = 0
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString()
    if (url === 'https://auth.openai.com/oauth/token') {
      refreshes++
      if (!(init?.body instanceof URLSearchParams)) throw new Error('Expected form body')
      expect(init.body.get('refresh_token')).toBe('original-refresh')
      return Response.json({ access_token: access, refresh_token: 'rotated-refresh', expires_in: 3600 })
    }
    if (!url.startsWith(`${endpoint}/`)) throw new Error('Unexpected network destination')
    return nativeFetch(input, init)
  })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, { providers: { 'openai-codex': { baseURL: endpoint, transport: 'sse' } } })
  const collections = [0, 1].map(() => {
    const models = createModels({ credentials: credentialStoreFrom(ctx!), authContext: authContextFrom(ctx!) })
    models.setProvider(catalogProvider('openai-codex')!)
    return models
  })
  await Promise.all(collections.map(models => models.getAuth('openai-codex')))
  expect(refreshes).toBe(1)
  expect(await credentialStoreFrom(ctx).read('openai-codex')).toMatchObject({ access, refresh: 'rotated-refresh', accountId: 'fixture-account' })
  const result = await assemble(ctx, { provider: 'openai-codex', model: 'gpt-5.5', messages: [createUserMessage({ content: [{ type: 'text', text: 'Check the account.' }], source: { kind: 'plugin', plugin: 'test' } })] })
  expect(result.finish).toEqual({ kind: 'stop' })
  expect(result.message.content).toMatchObject([{ type: 'text', text: 'Account works.' }])
  expect(requests).toHaveLength(1)
  expect(requests[0]?.path).toBe('/codex/responses')
  expect(requests[0]?.headers.authorization).toBe(`Bearer ${access}`)
  expect(requests[0]?.headers['chatgpt-account-id']).toBe('fixture-account')
  expect(refreshes).toBe(1)
})
