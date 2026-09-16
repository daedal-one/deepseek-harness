import { fileURLToPath } from 'node:url'
import { clientBundle } from '../../client/tsdown.client.ts'

const shared = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-brand', '@deepseek-ai/dsh-typert-protocol', 'zod']

export default clientBundle('@deepseek-ai/dsh-api-remotes', ['lib/types/index.js'], {
  hostPhase: true,
  clientCompanions: [{
    entry: { portable: 'lib/types/client/portable.js' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'neutral',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
    define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') },
    alias: {
      '@deepseek-ai/dsh-client-store': fileURLToPath(new URL('../../client/store/lib/types/index.js', import.meta.url)),
      '@deepseek-ai/dsh-api-session-controller/client': fileURLToPath(new URL('../session-controller/lib/types/client/index.js', import.meta.url)),
      '@deepseek-ai/dsh-api-workspace-controller/client': fileURLToPath(new URL('../workspace-controller/lib/types/client/index.js', import.meta.url)),
      '@deepseek-ai/dsh-api-gateway/client': fileURLToPath(new URL('../gateway/lib/types/client/portable.js', import.meta.url)),
      '@deepseek-ai/dsh-client-connection/client/portable': fileURLToPath(new URL('../../client/connection/lib/types/client/portable.js', import.meta.url)),
      '@deepseek-ai/dsh-api-gateway/client/portable': fileURLToPath(new URL('../gateway/lib/types/client/portable.js', import.meta.url)),
      '@deepseek-ai/dsh-typert-registry/client/portable': fileURLToPath(new URL('../../typert/registry/lib/types/client/portable.js', import.meta.url)),
    },
    deps: {
      alwaysBundle: [/^(?:zustand|immer)(?:\/|$)/, /^@deepseek-ai\/dsh-[a-z0-9-]+\/(?:remote|client\/portable)$/, /^@deepseek-ai\/(?:dsh-client-connection|dsh-brand|dsh-util-values|dsh-client-store|dsh-session|dsh-util-workspace-path|dsh-deque|dsh-typert-protocol|schemastery|cosmokit)(?:\/|$)/],
      neverBundle: ['@deepseek-ai/cordis', 'zod'],
    },
  }, {
    entry: { portable: 'lib/types/client/portable.d.ts' },
    outDir: 'lib/client',
    format: ['esm'],
    platform: 'neutral',
    fixedExtension: false,
    clean: false,
    // Artifact resolution must not redirect declarations through source tsconfig paths.
    tsconfig: false,
    inputOptions: { tsconfig: false },
    dts: { dtsInput: true, emitDtsOnly: true, tsconfig: false, sideEffects: true },
    deps: {
      alwaysBundle: id => id.startsWith('@deepseek-ai/') && !shared.some(name => id === name || id.startsWith(`${name}/`)),
      neverBundle: shared,
    },
  }],
})
