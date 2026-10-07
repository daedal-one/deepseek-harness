import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { resolveTelemetryPatches } from '../src/profile-boot.ts'

const rows = [
  { id: 'custom-collector', name: '@deepseek-ai/dsh-session-telemetry-otel', disabled: false },
  { id: 'custom-log', name: '@deepseek-ai/dsh-session-log-deepseek', config: { enabled: true } },
  { id: 'custom-inventory', name: '@deepseek-ai/dsh-plugin-package-inventory-deepseek', config: { enabled: true } },
  { id: 'ordinary-plugin', name: '@deepseek-ai/dsh-session' },
]

describe('resolveTelemetryPatches', () => {
  it('keeps shipped reporting disabled without deployment environment setup', () => {
    const base = loadOverlayPatches('test', fileURLToPath(new URL(
      '../../../packages/bundle/base/cordis.patch.yml', import.meta.url,
    )))
    const entries = composeEntries([base])
    for (const id of ['session-telemetry-otel', 'session-log-deepseek', 'plugin-package-inventory-deepseek']) {
      expect(entries.find(row => row.id === id)?.disabled).toBe(true)
    }
    expect(entries.find(row => row.id === 'session-telemetry-otel')?.config).toEqual({ mode: 'DISABLED' })
  })

  it('overrides deployment opt-ins after the full patch stack is composed', () => {
    const authored = [{ insert: rows }]
    const optedOut = composeEntries([
      authored,
      resolveTelemetryPatches('1', composeEntries([authored])),
    ])
    expect(optedOut.slice(0, 3).every(row => row.disabled === true)).toBe(true)
    expect(optedOut[3]?.disabled).not.toBe(true)
  })

  it('preserves explicit opt-ins when the hard-disable switch is unset or empty', () => {
    expect(resolveTelemetryPatches(undefined, rows)).toEqual([])
    expect(resolveTelemetryPatches('', rows)).toEqual([])
  })

  it('disables every reporting module with custom ids on any non-empty value', () => {
    for (const value of ['1', '0', 'false', 'no']) {
      expect(resolveTelemetryPatches(value, rows)).toEqual([
        { id: 'custom-collector', disabled: true },
        { id: 'custom-log', disabled: true },
        { id: 'custom-inventory', disabled: true },
      ])
    }
  })

  it('does not require reporting rows in a custom profile', () => {
    expect(resolveTelemetryPatches('1', [])).toEqual([])
    expect(resolveTelemetryPatches('1', [{ id: 'ordinary', name: '@fixture/ordinary' }])).toEqual([])
  })
})
