import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

// The controller's no-follow directory descriptors and permission checks require POSIX semantics.
describe.skipIf(process.platform === 'win32')('workspace export controller records and authority', () => {
  it('validates durable records, bounded pages, source authority and interrupted intent', async () => {
    const result = await promisify(execFile)('python3', ['-B', 'scripts/workspace-exports/controller_test.py'])
    expect(result.stderr).toContain('Ran 6 tests')
    expect(result.stderr).toMatch(/\bOK\b/)
  })

  it('adopts only the approved catalogue and refuses downgrades that would orphan retained aliases', async () => {
    const result = await promisify(execFile)('python3', ['-B', 'scripts/workspace-exports/adoption_test.py'])
    expect(result.stderr).toContain('Ran 12 tests')
    expect(result.stderr).toMatch(/\bOK\b/)
  })
})
