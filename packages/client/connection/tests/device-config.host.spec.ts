import { describe, expect, it } from 'vitest'
import { Config } from '../src/index.ts'

describe('device access configuration', () => {
  it('keeps device access disabled when Loader resolves an omitted configuration', () => {
    expect(Config({}).deviceAccess).toBeUndefined()
  })
  it('requires every deployment limit when device access is selected', () => {
    expect(() => Config({ deviceAccess: {} } as never)).toThrow('enrollmentTtlMs')
    const deviceAccess = { enrollmentTtlMs: 60_000, maxPendingEnrollments: 2, maxDevices: 4 }
    expect(Config({ deviceAccess }).deviceAccess).toEqual(deviceAccess)
  })
})
