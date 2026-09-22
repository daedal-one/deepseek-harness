import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-user-questions', ['lib/types/index.js'], {
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
    deps: { alwaysBundle: [/^@deepseek-ai\/dsh-/], neverBundle: ['@deepseek-ai/cordis'] },
  }],
})
