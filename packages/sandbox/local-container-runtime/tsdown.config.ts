import { defineConfig } from 'tsdown'

export default defineConfig({ entry: ['lib/types/{index,engine,startup,workspaces,tool-request-repo-access,vm,shared-vm,vm-previews}.js'] })
