/** Portable application artifacts preserve generated APIs after async transforms. */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'

const artifactRequire = createRequire(new URL('../package.json', import.meta.url))
const artifact = artifactRequire.resolve('@deepseek-ai/dsh-api-remotes/client/portable')

it('awaits the generated assembly and disposes calls and streams after async lowering', { retry: 0 }, () => {
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--experimental-import-meta-resolve', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { isBuiltin } from 'node:module';
    import { fileURLToPath, pathToFileURL } from 'node:url';
    import { SourceTextModule, createContext } from 'node:vm';
    const { build } = await import(process.argv[2]);
    const dir = mkdtempSync(join(tmpdir(), 'dsh-portable-async-'));
    const context = createContext({ URL, AbortController, AbortSignal, queueMicrotask, setTimeout, clearTimeout, console, Intl: undefined });
    const modules = new Map();
    function fileModule(file) {
      if (!modules.has(file)) modules.set(file, new SourceTextModule(readFileSync(file, 'utf8'), { context, identifier: file }));
      return modules.get(file);
    }
    function link(specifier, parent) {
      if (isBuiltin(specifier)) throw new Error('portable dependency: ' + specifier);
      const origin = parent.identifier.startsWith(dir) ? process.argv[1] : parent.identifier;
      return fileModule(fileURLToPath(import.meta.resolve(specifier, pathToFileURL(origin))));
    }
    async function load(file) {
      const mod = fileModule(file);
      if (mod.status === 'unlinked') await mod.link(link);
      if (mod.status === 'linked') await mod.evaluate();
      return mod.namespace;
    }
    let ctx;
    let gateway;
    let assembly;
    let logical;
    let workspaces;
    let sessions;
    try {
      const forbidden = new SourceTextModule('import fs from "node:fs"', { context });
      await assert.rejects(forbidden.link(link), /portable dependency/);
      const page = new SourceTextModule('window.document.createElement("div")', { context });
      await page.link(link);
      await assert.rejects(page.evaluate(), /window is not defined/);
      await build({ config: false, entry: { portable: process.argv[1] }, outDir: dir, format: ['esm'],
        platform: 'neutral', target: 'es2015', fixedExtension: false, dts: false, clean: false,
        deps: { neverBundle: ['@deepseek-ai/cordis', 'zod'] } });
      const api = await load(join(dir, 'portable.js'));
      const identity = await api.readHostIdentity({ call: async (channel, endpoint, payload) => {
        assert.equal(channel, '/api'); assert.equal(endpoint, 'connection/identity'); assert.equal(Object.keys(payload).length, 0);
        return { ok: true, value: { version: 1, hostId: '26e99520-f2d3-4874-84b5-07c5ef24775d', activationId: 'f5292bdb-ebda-41ba-b473-6c587a3c1d02' } };
      } });
      assert.equal(identity.value.hostId, '26e99520-f2d3-4874-84b5-07c5ef24775d');
      const capabilities = await api.readHostCapabilities({ call: async (channel, endpoint, payload) => {
        assert.equal(channel, '/api'); assert.equal(endpoint, '$capabilities'); assert.equal(Object.keys(payload).length, 0);
        return { ok: true, value: { version: 3, identity: identity.value,
          capabilities: [{ endpoint: 'session/follow', mode: 'stream', availability: 'available', semanticRevision: 1, wireFingerprint: 'typert-wire-v1:' + 'a'.repeat(64) }] } };
      } }, identity.value);
      assert.equal(capabilities.ok, true);
      assert.equal(capabilities.value.capabilities[0].endpoint, 'session/follow');
      assert.equal(capabilities.value.capabilities[0].semanticRevision, 1);
      assert.equal(capabilities.value.capabilities[0].wireFingerprint, 'typert-wire-v1:' + 'a'.repeat(64));
      const { Context } = await load(fileURLToPath(import.meta.resolve('@deepseek-ai/cordis', pathToFileURL(process.argv[1]))));
      ctx = new Context();
      await ctx.plugin({ apply: api.applyRegistry, inject: api.registryInject });
      const requiredCapabilities = api.selectRemoteCapabilities(['workspace/follow', 'workspace/rename', 'session/list', 'session/control', 'session/follow', 'session/prompt', 'session/search', 'subagents/list']);
      assert.equal(requiredCapabilities.length, 8);
      assert.equal(api.selectRemoteCapabilities(['session/follow', 'session/follow']).length, 1);
      assert.equal(api.selectRemoteCapabilities([]).length, 0);
      assert.throws(() => api.selectRemoteCapabilities(['absent/method']), /lacks generated compatibility evidence/);
      const calls = [];
      const workspace = id => ({ workspaceId: id, title: id, path: '/work/' + id, sessionIds: [],
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
      const waitSnapshot = (source, accepted) => {
        if (accepted(source.getSnapshot())) return Promise.resolve();
        return new Promise(resolve => {
          const stop = source.subscribe(() => { if (accepted(source.getSnapshot())) { stop(); resolve(); } });
        });
      };
      const connection = api.createConnection({ isLoopback: false,
        rpc: { call: async (...args) => {
          if (args[1] === '$capabilities') return { ok: true, value: { version: 3, identity: identity.value,
            capabilities: requiredCapabilities.map(requirement => ({ ...requirement, availability: 'available' })) } };
          calls.push(args);
          assert.equal(args[2].compatibility.semanticRevision, 1);
          assert.match(args[2].compatibility.wireFingerprint, /^typert-wire-v1:[0-9a-f]{64}$/);
          assert.equal(args[2].compatibility.identity.activationId, identity.value.activationId);
          if (args[1] === 'session/search') return { ok: true, value: { items: [], hasMore: false } };
          if (args[1] === 'subagents/list') return { ok: true, value: { entries: [], parentAvailable: true } };
          if (args[1] === 'session/list') return { ok: true, value: { items: [{ sessionId: 'portable-session', updatedAt: 1, running: false, blank: false }] } };
          if (args[1] === 'session/prompt') {
            assert.equal(args[2].args.request.requestId, 'device-request-1');
            assert.equal(args[2].args.request.clientTimeZone, 'Europe/Rome');
            return { ok: true, value: { accepted: true } };
          }
          assert.equal(args[1], 'workspace/rename');
          return { ok: true, value: { workspace: { ...workspace(args[2].args.request.workspaceId), title: args[2].args.request.title, updatedAt: '2026-01-02T00:00:00.000Z' } } };
        } },
      });
      ctx.provide('connection', connection);
      const frames = [];
      const callbacks = new Map();
      let socket;
      let id = 0;
      gateway = ctx.plugin({ inject: ['typert', 'connection'], apply(scope) { api.applyRemoteClient(scope, {
        baseUrl: 'https://portable.example', randomId: () => 'portable-' + (++id), expectedHostId: identity.value.hostId, requiredCapabilities,
        createAbortController: () => new AbortController(),
        createSocket: () => {
          socket = {
            readyState: 0,
            addEventListener: (type, listener) => callbacks.set(type, listener),
            removeEventListener: type => callbacks.delete(type),
            close: () => { socket.readyState = 3; callbacks.get('close')?.(); },
            send: data => {
              const frame = JSON.parse(data); frames.push(frame);
              if (frame.type !== 'open') return;
              let value;
              if (frame.endpoint === '$events') value = { type: 'ready', protocolVersion: 1, clientId: 'portable-client', host: { home: '/portable', identity: identity.value } };
              else if (frame.endpoint === 'workspace/follow') value = { type: 'baseline', value: { items: [workspace('alpha'), workspace('beta')], archivedSessionIds: [] } };
              else if (frame.endpoint === 'session/control') value = { type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } };
              else if (frame.endpoint === 'session/follow') value = {
                type: 'snapshot', header: { version: 3, id: 'portable-session', createdAt: 0, isSeeded: false },
                cursor: -1, records: [], hasMore: false, projections: { asOfSeq: -1, values: {} }, assistantStream: { revision: 0 },
              };
              else throw new Error('unexpected portable stream ' + frame.endpoint);
              queueMicrotask(() => callbacks.get('message')?.({ data: JSON.stringify({ type: 'item', streamId: frame.streamId, value }) }));
            },
          };
          queueMicrotask(() => { socket.readyState = 1; callbacks.get('open')?.(); });
          return socket;
        },
      }); } });
      await gateway;
      if (!connection.generation.getSnapshot()) await new Promise(resolve => {
        const stop = connection.generation.subscribe(() => {
          if (connection.generation.getSnapshot()) { stop(); resolve(); }
        });
      });
      assert.equal(ctx.remote.$host.capabilities.capabilities.length, requiredCapabilities.length);
      assembly = ctx.plugin(api);
      await assembly;
      assert.equal(typeof ctx.remote.workspaceFiles.read, 'function');
      assert.ok(ctx.typert.remotes.list().every(descriptor => /^typert-wire-v1:[0-9a-f]{64}$/.test(descriptor.wireFingerprint)));
      const search = ctx.remote.session.search;
      await assert.rejects(async () => search({ query: 12 }));
      assert.equal(calls.length, 0);
      const response = await search({ query: 'native' });
      assert(response.ok && response.value.items.length === 0 && response.value.hasMore === false);
      assert.equal(calls[0][0], '/api');
      assert.equal(calls[0][1], 'session/search');
      logical = ctx.remote.$stream({ name: 'workspaces', open: signal => ctx.remote.workspace.follow(signal), ended: () => new Error('unexpected end') });
      const iterator = logical[Symbol.asyncIterator]();
      const first = await iterator.next();
      assert(!first.done && first.value.value.type === 'baseline');
      first.value.accept();
      const next = iterator.next();
      await logical.dispose();
      assert((await next).done);
      assert(first.value.signal.aborted);
      workspaces = ctx.plugin({ apply: api.applyWorkspaces, inject: api.workspaceInject });
      await workspaces;
      const source = ctx.workspaces.list;
      await waitSnapshot(source, value => value.phase === 'ready');
      assert.equal(source.getSnapshot().items.length, 2);
      const independent = new api.ClientWorkspaceModel(ctx.remote.workspace);
      const renamed = await ctx.workspaces.rename('alpha', 'Renamed');
      assert.equal(renamed.title, 'Renamed');
      assert.equal(source.getSnapshot().items[0].title, 'Renamed');
      const streamId = frames.filter(frame => frame.type === 'open' && frame.endpoint === 'workspace/follow').at(-1).streamId;
      const send = value => callbacks.get('message')({ data: JSON.stringify({ type: 'item', streamId, value }) });
      send({ type: 'upsert', workspace: workspace('alpha') });
      send({ type: 'order', workspaceIds: ['beta', 'alpha'] });
      await waitSnapshot(source, value => value.items[0].workspaceId === 'beta');
      assert.equal(source.getSnapshot().items[1].title, 'Renamed');
      send({ type: 'archived', archivedSessionIds: ['archived-session'] });
      await waitSnapshot(source, value => value.archivedSessionIds.length === 1);
      assert.equal(source.getSnapshot().archivedSessionIds[0], 'archived-session');
      assert.equal(independent.getSnapshot().items.length, 0);
      await workspaces.dispose();
      const disposedSnapshot = source.getSnapshot();
      send({ type: 'remove', workspaceId: 'alpha' });
      assert.equal(source.getSnapshot(), disposedSnapshot);
      let selected = { sessionId: 'portable-session' };
      sessions = ctx.plugin({ apply: api.applySessions, inject: api.sessionInject }, {
        platform: { createRequestId: () => 'device-request-1', timeZone: () => 'Europe/Rome' },
        selection: { getSnapshot: () => selected, set: value => { selected = value; } },
      });
      await sessions;
      await waitSnapshot(ctx.sessions.list, state => state.phase === 'ready');
      assert.equal(ctx.sessions.list.getSnapshot().current, 'portable-session');
      const binding = ctx.sessions.binding('portable-session');
      assert(binding);
      await waitSnapshot(binding.session, state => state.openState === 'open');
      const pending = binding.session.beginSubmission({ mode: 'queue', text: 'Native prompt', attachments: [] });
      assert.equal(pending.requestId, 'device-request-1');
      assert((await binding.session.prompt([{ type: 'text', text: 'Native prompt' }], 'queue', undefined, pending.requestId)).ok);
      const followId = frames.find(frame => frame.type === 'open' && frame.endpoint === 'session/follow').streamId;
      callbacks.get('message')({ data: JSON.stringify({ type: 'item', streamId: followId, value: { type: 'event', event: {
        seq: 0, time: 1, type: 'user/message', surfaceOp: 'append',
        data: { id: 'native-message', role: 'user', content: [{ type: 'text', text: 'Native prompt' }], source: { kind: 'user', rpcId: pending.requestId } },
      } } }) });
      await waitSnapshot(binding.eventSource, state => state.entries.length === 1);
      assert.equal(binding.eventSource.getSnapshot().entries[0].event.data.content[0].text, 'Native prompt');
      await waitSnapshot(binding.session, state => state.pendingSubmissions.length === 0);
      ctx.sessions.clear();
      assert.equal(selected.sessionId, undefined);
      await sessions.dispose();
      const callsBeforeWithdrawal = calls.length;
      await assembly.dispose();
      assert.equal(ctx.typert.remotes.list().length, 0);
      assert.equal((await search({ query: 'withdrawn' })).ok, false);
      assert.equal(calls.length, callsBeforeWithdrawal);
      assert.equal(calls.filter(call => call[1] === 'session/prompt').length, 1);
      await gateway.dispose();
      assert.equal(connection.generation.getSnapshot(), undefined);
      assert.equal(socket.readyState, 3);
      assert.equal(frames.filter(frame => frame.type === 'open').length, 5);
      assert.equal(frames.filter(frame => frame.type === 'cancel').length, 5);
      console.log('portable application lifecycle passed');
    } finally {
      await sessions?.dispose();
      await workspaces?.dispose();
      await logical?.dispose();
      await assembly?.dispose();
      await gateway?.dispose();
      await ctx?.fiber.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  `, artifact, pathToFileURL(artifactRequire.resolve('tsdown')).href], { encoding: 'utf8', timeout: 60_000 })
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toContain('portable application lifecycle passed')
})

it('typechecks the portable application without workspace source aliases or Host packages', { retry: 0 }, () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { dirname, join } from 'node:path';
    import { createRequire } from 'node:module';
    import { spawnSync } from 'node:child_process';
    const require = createRequire(process.argv[1]);
    const dir = mkdtempSync(join(tmpdir(), 'dsh-portable-types-'));
    try {
      for (const name of ['@deepseek-ai/dsh-api-remotes', '@deepseek-ai/cordis', '@deepseek-ai/cosmokit', '@deepseek-ai/dsh-brand', '@deepseek-ai/dsh-typert-protocol', '@deepseek-ai/dsh-util-values', 'zod', '@standard-schema/spec']) {
        const ownerRequire = ['@standard-schema/spec', '@deepseek-ai/cosmokit'].includes(name) ? createRequire(require.resolve('@deepseek-ai/cordis')) : require;
        let root = dirname(ownerRequire.resolve(name));
        while (!existsSync(join(root, 'package.json')) || JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name !== name) {
          assert.notEqual(root, dirname(root), 'package manifest not found'); root = dirname(root);
        }
        const target = join(dir, 'node_modules', name);
        mkdirSync(target, { recursive: true });
        if (name.startsWith('@deepseek-ai/')) {
          cpSync(join(root, 'package.json'), join(target, 'package.json'));
          cpSync(join(root, 'lib'), join(target, 'lib'), { recursive: true });
        } else cpSync(root, target, { recursive: true });
      }
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
      writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
        target: 'ES2024', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
        skipLibCheck: false, noEmit: true, types: [], lib: ['ES2024', 'DOM', 'DOM.Iterable'],
      }, files: ['index.ts'] }));
      writeFileSync(join(dir, 'index.ts'), \`
        import * as api from '@deepseek-ai/dsh-api-remotes/client/portable';
        import { Context } from '@deepseek-ai/cordis';
        const ctx = new Context();
        await ctx.plugin({ apply: api.applyRegistry, inject: api.registryInject });
        const connection = api.createConnection({ isLoopback: false, rpc: { call: async () => ({ ok: true, value: null }) } });
        const identity = await api.readHostIdentity(connection.rpc);
        if (!identity.ok) throw new Error('Host identity unavailable');
        api.applyRemoteClient(ctx, { requiredCapabilities: api.selectRemoteCapabilities(['session/follow']), expectedHostId: identity.value.hostId, baseUrl: 'https://portable.example', randomId: () => 'id', createSocket: () => { throw new Error('offline'); }, createAbortController: () => new AbortController() });
        await ctx.plugin(api);
        const response = await ctx.remote.session.search({ query: 'native' });
        if (response.ok) { const more: boolean = response.value.hasMore; void more; }
        // @ts-expect-error generated search requires a string query
        await ctx.remote.session.search({ query: 12 });
        const stream: api.RemoteStream<api.WorkspaceFollowFrame> = ctx.remote.$stream({ name: 'workspaces', open: signal => ctx.remote.workspace.follow(signal), ended: () => new Error('ended') });
        await ctx.plugin({ apply: api.applyWorkspaces, inject: api.workspaceInject });
        const workspaces: api.WorkspaceSnapshot = ctx.workspaces.list.getSnapshot();
        const renamed: api.WorkspaceView = await ctx.workspaces.rename(workspaces.items[0].workspaceId, 'Renamed');
        let selected: api.SessionSelection = {};
        const options: api.SessionClientOptions = {
          platform: { createRequestId: () => 'native-id' as api.SessionRequestId, timeZone: () => 'Europe/Rome' },
          selection: { getSnapshot: () => selected, set: value => { selected = value; } },
        };
        await ctx.plugin({ apply: api.applySessions, inject: api.sessionInject }, options);
        const list: api.SessionListState = ctx.sessions.list.getSnapshot();
        const session: api.SessionBinding | undefined = ctx.sessions.binding(list.ids[0]);
        void connection; void stream; void renamed; void session;
      \`);
      const checked = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', dir], { encoding: 'utf8', timeout: 45_000 });
      assert.equal(checked.error, undefined);
      assert.equal(checked.signal, null);
      assert.equal(checked.status, 0, checked.stdout + checked.stderr);
      console.log('portable application declarations passed');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  `, artifact], { encoding: 'utf8', timeout: 60_000 })
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toContain('portable application declarations passed')
})
