/** The public stream carrier runs without a page, socket global, or native module. */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'

it('opens and closes streams through the published portable artifact', { retry: 0 }, () => {
  const artifact = createRequire(new URL('../package.json', import.meta.url))
    .resolve('@deepseek-ai/dsh-api-gateway/client/portable')
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--experimental-import-meta-resolve', '--input-type=module', '-e', `
    import { readFileSync } from 'node:fs';
    import { SourceTextModule, createContext } from 'node:vm';
    import assert from 'node:assert/strict';
    import { isBuiltin } from 'node:module';
    import { fileURLToPath, pathToFileURL } from 'node:url';
    import { createServer } from 'node:http';
    const context = createContext({ URL, queueMicrotask, AbortController, AbortSignal, setTimeout, clearTimeout, console });
    const modules = new Map();
    function fileModule(file) {
      let module = modules.get(file);
      if (module === undefined) {
        module = new SourceTextModule(readFileSync(file, 'utf8'), { context, identifier: file });
        modules.set(file, module);
      }
      return module;
    }
    function link(specifier, parent) {
      if (isBuiltin(specifier)) throw new Error('portable dependency: ' + specifier);
      return fileModule(fileURLToPath(import.meta.resolve(specifier, pathToFileURL(parent.identifier))));
    }
    async function loadFile(file) {
      const module = fileModule(file);
      if (module.status === 'unlinked') await module.link(link);
      if (module.status === 'linked') await module.evaluate();
      return module.namespace;
    }
    async function load(source) {
      const module = new SourceTextModule(source, { context });
      await module.link(specifier => { throw new Error('portable dependency: ' + specifier); });
      await module.evaluate();
      return module.namespace;
    }
    await assert.rejects(load('import fs from "node:fs"'), /portable dependency/);
    await assert.rejects(load('window.document.createElement("div")'), /window is not defined/);
    const api = await loadFile(process.argv[1]);
    assert.equal(typeof api.applyRemoteClient, 'function');
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
    const resolveArtifact = specifier => fileURLToPath(import.meta.resolve(specifier, pathToFileURL(process.argv[1])));
    const { Context } = await loadFile(resolveArtifact('@deepseek-ai/cordis'));
    const { default: Registry } = await loadFile(resolveArtifact('@deepseek-ai/dsh-typert-registry'));
    const { z } = await loadFile(resolveArtifact('zod'));
    const ctx = new Context();
    await ctx.plugin(Registry);
    const calls = [];
    const identity = { version: 1, hostId: '26e99520-f2d3-4874-84b5-07c5ef24775d', activationId: 'f5292bdb-ebda-41ba-b473-6c587a3c1d02' };
    const generation = { id: 1, host: { home: '/fixture', identity } };
    let stopped = false;
    let unregistered = false;
    ctx.provide('connection', {
      generation: { getSnapshot: () => generation, subscribe: () => () => {} },
      rpc: {
        call: async (...args) => { calls.push(args); return { ok: true, value: 42 }; },
        open: async function* () { throw new Error('unexpected stream'); },
      },
      registerGenerationSource: () => () => { unregistered = true; },
      start: () => ({ stop: () => { stopped = true; } }),
    });
    const plugin = ctx.plugin({ apply: (scope) => api.applyRemoteClient(scope, {
      baseUrl: 'https://artifact.example', randomId: () => 'artifact-events', expectedHostId: identity.hostId, requiredCapabilities: [],
      createAbortController: () => new AbortController(),
      createSocket: () => { throw new Error('direct Connection carrier must remain selected'); },
    }) });
    await plugin;
    const unmount = await ctx.remote.$mount({
      package: '@fixture/portable-artifact',
      descriptors: [{
        wireFingerprint: 'typert-wire-v1:' + 'a'.repeat(64), semanticRevision: 1,
        id: '@fixture/portable-artifact#probe/read', service: 'probe', namespace: 'probe', method: 'read',
        invocation: { kind: 'direct' }, parameters: [],
        result: { mode: 'strict', typeSymbol: '@fixture#Number', schema: z.number() },
      }],
    });
    const retained = ctx.remote.probe.read;
    assert.equal((await retained()).value, 42);
    assert.equal(calls[0][0], '/api');
    assert.equal(calls[0][1], 'probe/read');
    assert.equal(JSON.stringify(calls[0][2].compatibility), JSON.stringify({
      wireFingerprint: 'typert-wire-v1:' + 'a'.repeat(64), semanticRevision: 1, identity,
    }));
    await unmount();
    assert.equal((await retained()).ok, false);
    assert.equal(calls.length, 1);
    await plugin.dispose();
    assert.equal(stopped, true);
    assert.equal(unregistered, true);
    const { RemoteStreamMuxServer } = await import(new URL('./types/stream-server.js', pathToFileURL(process.argv[1])));
    let returned;
    const didReturn = new Promise(resolve => { returned = resolve; });
    const mux = new RemoteStreamMuxServer(async function* (endpoint, payload, signal) {
      assert.equal(endpoint, 'fixture/follow');
      assert.deepEqual(payload, { label: 'native' });
      try {
        yield 'native:ready';
        await new Promise(resolve => {
          if (signal.aborted) resolve();
          else signal.addEventListener('abort', resolve, { once: true });
        });
      } finally { returned(); }
    }, error => ({ code: 'internal', message: String(error), details: {} }), 2000);
    const http = createServer();
    http.on('upgrade', (request, socket, head) => mux.handleUpgrade(request, socket, head));
    let wireCarrier;
    try {
      await new Promise((resolve, reject) => {
        http.once('error', reject);
        http.listen(0, '127.0.0.1', resolve);
      });
      wireCarrier = api.createRemoteStreamMux({
        baseUrl: 'http://127.0.0.1:' + http.address().port,
        randomId: () => 'portable-wire-stream',
        createSocket: url => new WebSocket(url),
      });
      wireCarrier.start();
      const controller = new AbortController();
      const stream = wireCarrier.open('fixture/follow', { label: 'native' }, controller.signal);
      assert.equal((await stream.next()).value, 'native:ready');
      const stopped = assert.rejects(stream.next(), /stop native stream/);
      controller.abort(new Error('stop native stream'));
      await stopped;
      await didReturn;
    } finally {
      await wireCarrier?.close();
      await mux.close();
      if (http.listening) await new Promise((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
    }
    console.log('portable stream artifact passed');
  `, artifact], { encoding: 'utf8', timeout: 30_000 })
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toContain('portable stream artifact passed')
})
