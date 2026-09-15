import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-connection', ['lib/types/index.js'], {
  companions: [{
    entry: { portable: 'lib/types/client/portable.js' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'neutral',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { alwaysBundle: [/@deepseek-ai\/(schemastery|cosmokit)/] },
  }],
})
