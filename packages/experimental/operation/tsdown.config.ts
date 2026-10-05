import { defineConfig } from 'tsdown'

/** Emit the runner and scoped coding-composition entrypoints. */
export default defineConfig({
  entry: ['lib/types/{index,agent}.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
