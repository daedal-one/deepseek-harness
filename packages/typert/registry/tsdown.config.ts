import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-typert-registry', ['lib/types/index.js'], {
  hostPhase: false,
  clientCompanions: [{
    entry: { portable: 'lib/types/client/portable.js' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'neutral',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: {
      neverBundle: ['@deepseek-ai/cordis', 'zod'],
    },
  }],
})
