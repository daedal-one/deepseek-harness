/** Built portable entry executes without Node modules, a DOM, or page bootstrap state. */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'

it('loads the published ESM companion in a restricted JavaScript context', { retry: 0 }, () => {
  const artifact = createRequire(new URL('../package.json', import.meta.url))
    .resolve('@deepseek-ai/dsh-client-connection/client/portable')
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', `
    import { readFileSync } from 'node:fs';
    import { SourceTextModule, createContext } from 'node:vm';
    import assert from 'node:assert/strict';
    const context = createContext({ URL, AbortController, setTimeout, clearTimeout, console });
    async function load(source) {
      const module = new SourceTextModule(source, { context });
      await module.link(specifier => { throw new Error('portable dependency: ' + specifier); });
      await module.evaluate();
      return module.namespace;
    }
    await assert.rejects(load('import fs from "node:fs"'), /portable dependency/);
    await assert.rejects(load('window.document.createElement("div")'), /window is not defined/);
    const api = await load(readFileSync(process.argv[1], 'utf8'));
    const rpc = api.createConnectionRpc({
      baseUrl: 'https://host.example', randomId: () => api.RpcId('test'),
      fetch: async (url, init) => {
        assert.ok(['https://host.example/api/sessions/list', 'https://host.example/api/connection/identity'].includes(url.href));
        assert.equal(JSON.parse(init.body).rpcId, 'test');
        return { ok: true, json: async () => ({
          type: 'server-response', rpcId: 'test', result: { ok: true, value: url.pathname.endsWith('/identity') ? {
            version: 1, hostId: '26e99520-f2d3-4874-84b5-07c5ef24775d', activationId: 'f5292bdb-ebda-41ba-b473-6c587a3c1d02',
          } : 42 },
        }) };
      },
    });
    const connection = api.createConnection({ rpc, isLoopback: false });
    assert.equal(connection.isLoopback, false);
    assert.equal((await connection.rpc.call('/api', 'sessions/list', {})).value, 42);
    assert.equal((await api.readHostIdentity(connection.rpc)).value.hostId, '26e99520-f2d3-4874-84b5-07c5ef24775d');
    console.log('portable artifact passed');
  `, artifact], { encoding: 'utf8', timeout: 30_000 })
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toContain('portable artifact passed')
})
