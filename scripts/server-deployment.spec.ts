/** Linux deployment controller failure paths, using private filesystem fixtures. @module */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it.skipIf(process.platform === 'win32')('preserves histories and rejects stale or duplicate deployment requests', () => {
  // The controller requires POSIX flock and ownership; Windows is not a deployment host.
  const output = execFileSync('python3', ['-B', fileURLToPath(new URL('./server-deployment/test_controller.py', import.meta.url))], {
    encoding: 'utf8',
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  expect(output).toBe('')
})
