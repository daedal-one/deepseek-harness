/** Built answer consumers share pending ownership without browser or Host dependencies. */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'

it('answers and delegates requests through the portable domain artifacts', { retry: 0 }, () => {
  const artifact = createRequire(new URL('../package.json', import.meta.url))
    .resolve('@deepseek-ai/dsh-client-ui-session/client/portable')
  const approval = createRequire(new URL('../package.json', import.meta.url))
    .resolve('@deepseek-ai/dsh-client-ui-approval/client/portable')
  const question = createRequire(new URL('../../ui-user-questions/package.json', import.meta.url))
    .resolve('@deepseek-ai/dsh-client-ui-user-questions/client/portable')
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
    const api = await load(process.argv[1]);
    const { Context } = await load(fileURLToPath(import.meta.resolve('@deepseek-ai/cordis', pathToFileURL(process.argv[1]))));
    const approval = await load(process.argv[2]);
    const question = await load(process.argv[3]);
    const ctx = new Context();
    const pending = new api.PendingInteractions();
    const owner = ctx.extend({ requestOwner: true });
    const listeners = new Map();
    const remote = { $on: (event, listener) => {
      const off = ctx.effect(() => { listeners.set(event, listener); return () => listeners.delete(event); });
      return () => { void off(); };
    } };
    const sessions = { scopeOf: candidate => candidate === owner ? 'session' : undefined };
    const register = precedence => pending.register(ctx, precedence);
    try {
      approval.registerApprovalRequests(remote, sessions, register);
      question.registerQuestionRequests(remote, sessions, register);
      const a = listeners.get('approval/request').call(owner, { agent: owner, toolName: 'bash' }, async () => 'unavailable');
      const approvalRequest = pending.source.getSnapshot().get('session');
      assert.equal(approvalRequest instanceof approval.PendingApproval, true);
      const q = listeners.get('user-questions/request').call(owner, { questions: [{ id: 'q', question: 'Choose' }] }, async () => ({ answers: [] }));
      const questionRequest = pending.source.getSnapshot().get('session');
      assert.equal(questionRequest instanceof question.PendingQuestion, true);
      await questionRequest.answer({ answers: [{ id: 'q', selected: ['Yes'] }] });
      assert.equal((await q).answers[0].selected[0], 'Yes');
      assert.equal(pending.source.getSnapshot().get('session'), approvalRequest);
      await approvalRequest.answer('allowed-once');
      assert.equal(await a, 'allowed-once');
      assert.equal(pending.source.getSnapshot().size, 0);
      const unanswered = listeners.get('approval/request').call(owner, { agent: owner, toolName: 'bash' }, async () => 'unavailable');
      await ctx.fiber.dispose();
      assert.equal(await unanswered, 'unavailable');
      assert.equal(listeners.size, 0);
      assert.equal(pending.source.getSnapshot().size, 0);
    } finally {
      await ctx.fiber.dispose();
    }
    console.log('portable answer consumers artifact passed');
  `, artifact, approval, question], { encoding: 'utf8', timeout: 30_000 })
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toContain('portable answer consumers artifact passed')
})
