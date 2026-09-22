/** Built pending-interaction ownership needs no browser globals or Node builtins. */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'

it('settles pending requests through the renderer-independent built artifact', { retry: 0 }, () => {
  const artifact = createRequire(new URL('../package.json', import.meta.url))
    .resolve('@deepseek-ai/dsh-client-ui-session/client/portable')
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
    const ctx = new Context();
    const pending = new api.PendingInteractions();
    let off;
    try {
      let notifications = 0;
      off = pending.source.subscribe(() => { notifications++; });
      const publish = pending.register(ctx, () => 1);
      const request = { key: 'native-approval', kind: 'approval', sessionId: 'session' };
      let delegated = false;
      publish(request, async () => {
        assert.equal(pending.source.getSnapshot().size, 0);
        delegated = true;
      });
      assert.equal(pending.source.getSnapshot().get('session'), request);
      assert.equal(notifications, 1);
      await ctx.fiber.dispose();
      assert.equal(delegated, true);
      assert.equal(notifications, 2);
      assert.throws(() => publish(request, async () => {}), /domain is disposed/);
    } finally {
      off?.();
      await ctx.fiber.dispose();
    }
    console.log('portable pending interactions artifact passed');
  `, artifact], { encoding: 'utf8', timeout: 30_000 })
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toContain('portable pending interactions artifact passed')
})
