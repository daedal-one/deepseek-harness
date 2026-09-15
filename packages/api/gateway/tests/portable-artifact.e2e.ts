/** The public stream carrier runs without a page, socket global, or native module. */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'

it('opens and closes streams through the published portable artifact', { retry: 0 }, () => {
  const artifact = createRequire(new URL('../package.json', import.meta.url))
    .resolve('@deepseek-ai/dsh-api-gateway/client/portable')
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', `
    import { readFileSync } from 'node:fs';
    import { SourceTextModule, createContext } from 'node:vm';
    import assert from 'node:assert/strict';
    const context = createContext({ URL, queueMicrotask });
    async function load(source) {
      const module = new SourceTextModule(source, { context });
      await module.link(specifier => { throw new Error('portable dependency: ' + specifier); });
      await module.evaluate();
      return module.namespace;
    }
    await assert.rejects(load('import fs from "node:fs"'), /portable dependency/);
    await assert.rejects(load('window.document.createElement("div")'), /window is not defined/);
    const api = await load(readFileSync(process.argv[1], 'utf8'));
    const urls = [];
    const sockets = [];
    function createSocket(url) {
      urls.push(url);
      const callbacks = new Map();
      const socket = {
        readyState: 0,
        addEventListener: (type, callback) => callbacks.set(type, callback),
        removeEventListener: (type) => callbacks.delete(type),
        close: () => { socket.readyState = 3; callbacks.get('close')?.(); },
        send: (data) => {
          const frame = JSON.parse(data);
          assert.equal(frame.type, 'open');
          queueMicrotask(() => {
            callbacks.get('message')({ data: JSON.stringify({ type: 'item', streamId: frame.streamId, value: url }) });
            callbacks.get('message')({ data: JSON.stringify({ type: 'end', streamId: frame.streamId }) });
          });
        },
      };
      sockets.push(socket);
      queueMicrotask(() => { socket.readyState = 1; callbacks.get('open')(); });
      return socket;
    }
    const hosts = ['https://a.example', 'http://b.example:3080'];
    for (const baseUrl of hosts) {
      const carrier = api.createRemoteStreamMux({ baseUrl, createSocket, randomId: () => 'artifact-stream' });
      carrier.start();
      const signal = { aborted: false, addEventListener() {}, removeEventListener() {} };
      const values = [];
      for await (const value of carrier.open('feed/follow', {}, signal)) values.push(value);
      assert.equal(values.length, 1);
      assert.equal(values[0], urls.at(-1));
      await carrier.close();
      assert.equal(sockets.at(-1).readyState, 3);
    }
    assert.deepEqual(urls, ['wss://a.example/api/remote.mux', 'ws://b.example:3080/api/remote.mux']);
    console.log('portable stream artifact passed');
  `, artifact], { encoding: 'utf8', timeout: 30_000 })
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toContain('portable stream artifact passed')
})
