import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

const [state, guestPath, mode] = process.argv.slice(2)
const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const request = JSON.parse(Buffer.concat(chunks).toString())
const sources = JSON.parse(await readFile(state, 'utf8'))
if (request.operation === 'generation') {
  const generation = await readFile(state + '.generation', 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error
    return '1'.repeat(64)
  })
  process.stdout.write(JSON.stringify({ ok: true, value: generation }))
  process.exit(0)
}
if (mode === 'response') {
  process.stdout.write(await readFile(state + '.response', 'utf8'))
  process.exit(0)
}
const hash = value => createHash('sha256').update(value).digest('hex')
const mount = source => ({ source, path: `${guestPath}/${hash(source)}` })
let value
if (mode === 'bad-cursor') value = { mounts: [], next: 'f'.repeat(64) }
else if (mode === 'overflow') { process.stdout.write('x'.repeat(100000)); process.exit(0) }
else if (mode === 'combined-overflow') { process.stdout.write(' '.repeat(4096)); process.stderr.write('x'.repeat(4097)); process.exit(0) }
else if (mode === 'generation-change') {
  await writeFile(state + '.generation', '2'.repeat(64))
  value = { mounts: [], next: null }
}
else if (request.operation === 'select') {
  if (!sources.includes(request.source)) {
    sources.push(request.source)
    await writeFile(state, JSON.stringify(sources))
  }
  value = mount(request.source)
} else {
  const page = sources.map(source => [hash(source), source]).sort(([a], [b]) => a.localeCompare(b))
    .filter(([name]) => name > request.after).slice(0, 3)
  value = { mounts: page.slice(0, 2).map(([, source]) => mount(source)), next: page.length > 2 ? page[1][0] : null }
}
process.stdout.write(JSON.stringify({ ok: true, value }))
