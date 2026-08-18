import { describe, expect, it } from 'vitest'
import { requestedWorkspacePath } from '../src/client/requested-path.ts'

describe('requestedWorkspacePath', () => {
  it('accepts exact absolute workspace deep links and rejects relative identities', () => {
    expect(requestedWorkspacePath({ search: '?workspace=%2Fworkspaces%2Fforge%2Fatlas' }))
      .toBe('/workspaces/forge/atlas')
    expect(requestedWorkspacePath({ search: '?workspace=C%3A%5Cwork%5Catlas' })).toBe('C:\\work\\atlas')
    expect(requestedWorkspacePath({ search: '?workspace=PROJECT%3Aatlas' })).toBeUndefined()
    expect(requestedWorkspacePath({ search: '' })).toBeUndefined()
  })
})
