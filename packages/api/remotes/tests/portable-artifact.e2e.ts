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
    const context = createContext({ URL, AbortController, AbortSignal, queueMicrotask, setTimeout, clearTimeout, console });
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
      const { Context } = await load(fileURLToPath(import.meta.resolve('@deepseek-ai/cordis', pathToFileURL(process.argv[1]))));
      ctx = new Context();
      await ctx.plugin({ apply: api.applyRegistry, inject: api.registryInject });
      const calls = [];
      const connection = api.createConnection({ isLoopback: false,
        rpc: { call: async (...args) => { calls.push(args); return { ok: true, value: { items: [], hasMore: false } }; } },
      });
      ctx.provide('connection', connection);
      const frames = [];
      const callbacks = new Map();
      let socket;
      let id = 0;
      gateway = ctx.plugin({ inject: ['typert', 'connection'], apply(scope) { api.applyRemoteClient(scope, {
        baseUrl: 'https://portable.example', randomId: () => 'portable-' + (++id),
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
              const value = frame.endpoint === '$events'
                ? { type: 'ready', clientId: 'portable-client', host: { home: '/portable' } }
                : { type: 'baseline', value: { items: [], archivedSessionIds: [] } };
              assert(['$events', 'workspace/follow'].includes(frame.endpoint));
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
      assembly = ctx.plugin(api);
      await assembly;
      assert.equal(typeof ctx.remote.workspaceFiles.read, 'function');
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
      await assembly.dispose();
      assert.equal(ctx.typert.remotes.list().length, 0);
      assert.equal((await search({ query: 'withdrawn' })).ok, false);
      assert.equal(calls.length, 1);
      await gateway.dispose();
      assert.equal(connection.generation.getSnapshot(), undefined);
      assert.equal(socket.readyState, 3);
      assert.equal(frames.filter(frame => frame.type === 'open').length, 2);
      assert.equal(frames.filter(frame => frame.type === 'cancel').length, 2);
      console.log('portable application lifecycle passed');
    } finally {
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
        api.applyRemoteClient(ctx, { baseUrl: 'https://portable.example', randomId: () => 'id', createSocket: () => { throw new Error('offline'); }, createAbortController: () => new AbortController() });
        await ctx.plugin(api);
        const response = await ctx.remote.session.search({ query: 'native' });
        if (response.ok) { const more: boolean = response.value.hasMore; void more; }
        // @ts-expect-error generated search requires a string query
        await ctx.remote.session.search({ query: 12 });
        const stream: api.RemoteStream<api.WorkspaceFollowFrame> = ctx.remote.$stream({ name: 'workspaces', open: signal => ctx.remote.workspace.follow(signal), ended: () => new Error('ended') });
        void connection; void stream;
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
