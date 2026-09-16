/** Built Chat business composition runs with the shared Conversation core outside a browser. */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'

it('publishes actual Chat nodes through portable artifacts without a page or frame clock', { retry: 0 }, () => {
  const artifact = createRequire(new URL('../package.json', import.meta.url))
    .resolve('@deepseek-ai/dsh-client-ui-chat/client/portable')
  const core = createRequire(new URL('../package.json', import.meta.url))
    .resolve('@deepseek-ai/dsh-client-ui-conversation/client/portable')
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--experimental-import-meta-resolve', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { isBuiltin } from 'node:module';
    import { fileURLToPath, pathToFileURL } from 'node:url';
    import { SourceTextModule, createContext } from 'node:vm';
    const context = createContext({ queueMicrotask, setTimeout, clearTimeout, console });
    const modules = new Map();
    function fileModule(file) {
      if (!modules.has(file)) modules.set(file, new SourceTextModule(readFileSync(file, 'utf8'), { context, identifier: file }));
      return modules.get(file);
    }
    function link(specifier, parent) {
      if (isBuiltin(specifier)) throw new Error('portable dependency: ' + specifier);
      return fileModule(fileURLToPath(import.meta.resolve(specifier, pathToFileURL(parent.identifier))));
    }
    async function load(file) {
      const module = fileModule(file);
      if (module.status === 'unlinked') await module.link(link);
      if (module.status === 'linked') await module.evaluate();
      return module.namespace;
    }
    const forbidden = new SourceTextModule('import fs from "node:fs"', { context });
    await assert.rejects(forbidden.link(link), /portable dependency/);
    const page = new SourceTextModule('window.document.createElement("div")', { context });
    await page.link(link);
    await assert.rejects(page.evaluate(), /window is not defined/);
    const api = await load(process.argv[2]);
    const chat = await load(process.argv[1]);
    const { Context } = await load(fileURLToPath(import.meta.resolve('@deepseek-ai/cordis', pathToFileURL(process.argv[2]))));
    const ctx = new Context();
    let binding;
    let unsubscribe;
    const listeners = new Set();
    try {
      const events = new api.ConversationEventRegistry(ctx);
      const views = new api.ConversationViewRegistry(ctx);
      chat.registerChatConversation({ events, views, inspectRequestPrompt: api.inspectRequestPrompt, inspectSystemPrompt: api.inspectSystemPrompt });
      assert.equal(events.entries().length, 13);
      let window = { entries: [], revision: 0, hasMore: false, change: { kind: 'replace', entries: [] } };
      const feed = { getSnapshot: () => window, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } };
      binding = new api.ConversationBindingModel(feed, new api.ConversationNodeAssembler(events, views), null);
      const target = binding.target('chat');
      unsubscribe = target.subscribe(() => {});
      function append(entry) {
        window = { ...window, entries: [...window.entries, entry], revision: window.revision + 1, change: { kind: 'append', entries: [entry] } };
        for (const listener of listeners) listener();
      }
      append({ type: 'event', event: { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } } });
      append({ type: 'event', event: { type: 'step/start', seq: 2, time: 2, data: { turn: 1, step: 1 } } });
      append({ type: 'transient', event: { type: 'assistant/live-chunk', seq: 3, time: 3,
        data: { turn: 1, step: 1, attemptId: 'probe-attempt', chunk: { type: 'text-delta', index: 0, text: 'x' } } } });
      assert.equal(target.getSnapshot().navigation.items()[0].response, 'x');
      assert.equal(target.getSnapshot().nodes.values().some(node => node.kind === 'assistant-step'), true);
      assert.equal(listeners.size, 1);
      binding.dispose();
      assert.equal(listeners.size, 0);
      const snapshot = binding.snapshot.getSnapshot();
      append({ type: 'event', event: { type: 'turn/start', seq: 4, time: 4, data: { turn: 2 } } });
      assert.equal(binding.snapshot.getSnapshot(), snapshot);
    } finally {
      unsubscribe?.();
      binding?.dispose();
      await ctx.fiber.dispose();
    }
    console.log('portable Chat artifact passed');
  `, artifact, core], { encoding: 'utf8', timeout: 30_000 })
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toContain('portable Chat artifact passed')
})
