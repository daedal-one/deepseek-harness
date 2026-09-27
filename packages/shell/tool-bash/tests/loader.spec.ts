/** Real Loader composition proving session-scoped credential injection into bash. */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL('./fixtures/loader/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/loader/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

interface BashCredentialReport {
  allowedForeground: string
  allowedBackground: string
  deniedForeground: string
}

describe('tool-bash credentials through a real Loader composition', () => {
  it('exposes a configured reference only to its admitted session lineage', async () => {
    let report: BashCredentialReport | undefined
    const { stderr } = await runLoaderSmoke({
      label: 'tool-bash credential loader smoke',
      tempDirPrefix: 'tool-bash-credential-loader-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      env: { OPENROUTER_API_KEY: 'loader-secret' },
      inspect: async (cwd) => {
        report = JSON.parse(await readFile(join(cwd, 'bash-credential-report.json'), 'utf8')) as BashCredentialReport
      },
    })
    expect(stderr).not.toContain('loader-secret')
    expect(report?.allowedForeground).toBe('present')
    expect(report?.allowedBackground).toContain('present')
    expect(report?.allowedBackground).toContain('[status: completed, exit code: 0]')
    expect(report?.deniedForeground).toBe('absent')
  }, 45_000)
})
