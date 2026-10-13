import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeFixtureSafely } from './test-fixture-cleanup.ts'
import {
  checkCommitMessage,
  checkCommitMessageFile,
  closestSpecIds,
  collectSpecIds,
} from './verify-spec-ref-commit-msg.ts'

const fixtures: string[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) removeFixtureSafely(fixture)
})

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  fixtures.push(directory)
  return directory
}

/** A fixture repository root whose `.specs/` tree declares the given ids. */
function specRoot(ids: readonly string[]): string {
  const root = temporaryDirectory('spec-ref-ids-')
  for (const [index, id] of ids.entries()) {
    const file = join(root, '.specs', 'tasks', `fixture-${String(index)}.spec.md`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `---\nid: ${id}\ntype: task\nstatus: accepted\n---\n\n# Fixture\n`)
  }
  return root
}

/** A fixture commit message file holding the given text. */
function messageFile(text: string): string {
  const file = join(temporaryDirectory('spec-ref-message-'), 'COMMIT_EDITMSG')
  writeFileSync(file, text)
  return file
}

describe('verify-spec-ref-commit-msg', () => {
  it('accepts a feat commit whose trailer names a declared id', () => {
    const root = specRoot(['TASK:process/alpha', 'TASK:process/beta'])
    const file = messageFile('feat(tools): add a thing\n\nThe change does a thing.\n\nSpec-Ref: TASK:process/alpha\n')
    expect(collectSpecIds(root)).toEqual(['TASK:process/alpha', 'TASK:process/beta'])
    expect(checkCommitMessageFile(file, collectSpecIds(root))).toBeNull()
  })

  it('accepts a fragment reference onto a declared id', () => {
    const ids = ['REQ:ui/session-info-tab']
    expect(checkCommitMessage('fix(ui): correct a row\n\nSpec-Ref: REQ:ui/session-info-tab#c-render\n', ids)).toBeNull()
  })

  it('accepts the none form with a non-empty reason', () => {
    const message = 'feat(cli): reorganize argv parsing\n\nSpec-Ref: none (mechanical extraction, no intent change)\n'
    expect(checkCommitMessage(message, [])).toBeNull()
  })

  it('rejects the none form without a reason', () => {
    expect(checkCommitMessage('feat: x\n\nSpec-Ref: none\n', [])).toMatch(/non-empty reason/)
  })

  it('requires the trailer on feat, fix, and perf subjects', () => {
    for (const subject of ['feat: x', 'fix: x', 'perf: x']) {
      expect(checkCommitMessage(`${subject}\n\nbody\n`, [])).toMatch(/no `Spec-Ref:` trailer/)
    }
  })

  it('rejects a feat commit without a trailer', () => {
    const problem = checkCommitMessage('feat: add a capability\n\nSome body text.\n', [])
    expect(problem).toMatch(/no `Spec-Ref:` trailer/)
    expect(problem).toMatch(/Spec-Ref: none \(<reason>\)/)
  })

  it('rejects an unresolvable reference and names the closest ids', () => {
    const problem = checkCommitMessage('fix: x\n\nSpec-Ref: TASK:process/alpah\n', [
      'TASK:process/alpha',
      'TASK:process/beta',
    ])
    expect(problem).toMatch(/does not match any id declared under `\.specs\/`/)
    expect(problem).toContain('TASK:process/alpha')
  })

  it('caps the suggested ids at three', () => {
    expect(closestSpecIds('A:9', ['A:1', 'A:2', 'A:3', 'A:4', 'A:5'])).toHaveLength(3)
  })

  it('skips a merge commit', () => {
    expect(checkCommitMessage("Merge branch 'main' into topic\n", [])).toBeNull()
    expect(checkCommitMessage('Merge pull request #1 from x/y\n\nSpec-Ref: TASK:absent\n', [])).toBeNull()
  })

  it('exempts other conventional prefixes', () => {
    for (const subject of ['docs: x', 'chore: x', 'test: x', 'refactor: x', 'ci: x', 'build: x', 'style: x']) {
      expect(checkCommitMessage(`${subject}\n\nbody\n`, [])).toBeNull()
    }
  })

  it('ignores comment lines in the subject and trailer scan', () => {
    const message = '# comment\nfeat: x\n\nSpec-Ref: none (comment-safe)\n# trailing comment\n'
    expect(checkCommitMessage(message, [])).toBeNull()
  })

  it('treats a comment-only message as exempt and surfaces unreadable files', () => {
    expect(checkCommitMessage('# only comments\n', [])).toBeNull()
    expect(() => checkCommitMessageFile(join(temporaryDirectory('spec-ref-missing-'), 'absent'), [])).toThrow()
  })
})
