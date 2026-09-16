import { fileURLToPath } from 'node:url'
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-chat', ['lib/types/index.js'], {
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
      '@deepseek-ai/dsh-token-meter/client': fileURLToPath(new URL('../../llm/token-meter/lib/types/client.js', import.meta.url)),
      '@deepseek-ai/dsh-session/surface': fileURLToPath(new URL('../../core/session/lib/types/surface.js', import.meta.url)),
      '@deepseek-ai/dsh-client-store': fileURLToPath(new URL('../store/lib/types/index.js', import.meta.url)),
    },
    deps: { alwaysBundle: [/^@deepseek-ai\/dsh-/], neverBundle: ['@deepseek-ai/cordis'] },
  }],
})
