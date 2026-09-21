import { defineConfig } from 'tsdown'

export default defineConfig({ entry: ['lib/types/{index,startup,workspaces,vm,vm-previews}.js'] })
