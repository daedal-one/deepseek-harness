#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '../../../../..')
const home = process.argv[2] ? resolve(process.argv[2]) : join(repositoryRoot, 'tmp/paseo-dsh-poc')
const configPath = join(home, 'config.json')
const replayLauncher = join(scriptDirectory, 'run-dsh-acp-replay.sh')

const disabledProviders = Object.fromEntries(
  ['claude', 'codex', 'copilot', 'opencode', 'pi', 'omp'].map((provider) => [
    provider,
    { enabled: false },
  ]),
)

const config = {
  version: 1,
  features: {
    dictation: { enabled: false },
    voiceMode: { enabled: false },
  },
  agents: {
    providers: {
      ...disabledProviders,
      'dsh-replay': {
        extends: 'acp',
        label: 'DeepSeek Harness',
        description: 'Keyless ACP and mobile-relay compatibility proof.',
        command: [replayLauncher],
        env: {
          PASEO_DSH_POC_STATE_DIR: join(home, 'dsh-sessions'),
          DSH_PERMISSION_MODE: 'workspace-write',
        },
        params: {
          supportsMcpServers: false,
        },
      },
    },
  },
}

await mkdir(home, { recursive: true })

try {
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  })
} catch (error) {
  if (error?.code === 'EEXIST') {
    throw new Error(`Refusing to overwrite existing Paseo config: ${configPath}`)
  }
  throw error
}

console.log(configPath)
