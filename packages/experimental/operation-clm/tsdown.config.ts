import { defineConfig } from 'tsdown'

/** Emit the provider, tokenizer plugin, and shared local transport public entries. */
export default defineConfig({
  entry: ['lib/types/{index,tokenizer,local-http}.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
