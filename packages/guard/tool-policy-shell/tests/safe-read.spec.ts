import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isDeterministicRead } from '../src/safe-read.ts'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-policy-read-'))
  directories.push(directory)
  await writeFile(join(directory, 'input.txt'), 'keep\nskip\n', 'utf8')
  return directory
}

describe('deterministic read parser', () => {
  it('accepts a bounded read-only pipeline over resolved workspace files', async () => {
    const cwd = await fixture()
    await expect(isDeterministicRead("cat input.txt | grep -vc 'skip' | head -n 1", cwd)).resolves.toBe(true)
    await expect(isDeterministicRead('cat input.txt | sort | uniq | wc -l', cwd)).resolves.toBe(true)
    await expect(isDeterministicRead("sed -n '1,2p' input.txt", cwd)).resolves.toBe(true)
    await expect(isDeterministicRead('ls -la', cwd)).resolves.toBe(true)
    await expect(isDeterministicRead('rg --files --hidden .', cwd)).resolves.toBe(true)
  })

  it.each([
    'cat $(pwd)/input.txt',
    'cat input.txt > output.txt',
    'cat input.txt; touch output.txt',
    'tail -f input.txt',
    'grep skip -R .',
    'ls -RL .',
    'ls --recursive --dereference .',
    'sort -o output.txt input.txt',
    'sort -ooutput.txt input.txt',
    'sort --files0-from=/etc/hosts',
    'sort -T /etc input.txt',
    'wc --files0-from=/etc/hosts',
    "sed -n '1,2p;w output.txt' input.txt",
    "sed -n '1e id' input.txt",
    'rg --files --pre command',
  ])('rejects execution or write syntax in %s', async (command) => {
    const cwd = await fixture()
    await expect(isDeterministicRead(command, cwd)).resolves.toBe(false)
  })

  it('rejects paths whose resolved target escapes the workspace or temporary directory', async () => {
    const cwd = await fixture()
    await symlink('/etc/hosts', join(cwd, 'outside'))
    await expect(isDeterministicRead('cat outside', cwd)).resolves.toBe(false)
  })
})
