/** Real rootless runtime qualification; absent configured infrastructure is an explicit skip. */
import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DockerodePodmanEngine } from '@deepseek-ai/dsh-local-container-runtime/engine'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { PodmanArtifactRuntime } from '../src/index.ts'
import type { Config } from '../src/index.ts'
import type { ArtifactRevision, ArtifactProfile } from '@deepseek-ai/dsh-artifact'
import type { ArtifactInvocation } from '@deepseek-ai/dsh-artifact-runtime'

const socketPath = process.env.DSH_ARTIFACT_TEST_SOCKET
const image = process.env.DSH_ARTIFACT_TEST_IMAGE
const seccompProfilePath = process.env.DSH_ARTIFACT_TEST_SECCOMP
const qualified = socketPath !== undefined && image !== undefined && seccompProfilePath !== undefined
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
}, 60000)
const config = (): Config => ({
  socketPath: socketPath!,
  image: image!,
  seccompProfilePath: seccompProfilePath!,
  user: 'pwuser',
  memoryBytes: 805306368,
  nanoCpus: 1000000000,
  pidsLimit: 256,
  tmpfsBytes: 268435456,
  maxConcurrent: 2,
  maxQueue: 2,
  maxInputBytes: 4194304,
  maxOutputBytes: 2097152,
  maxLifetimeMs: 60000,
  operationTimeoutMs: 15000,
  width: 640,
  height: 480,
})
async function open(
  html: string | Buffer,
  profile: ArtifactProfile = 'interactive-local',
  patch: Partial<Config> = {},
  mediaType = 'text/html',
  extra: readonly { name: string; mediaType: string; data: string }[] = [],
): Promise<ArtifactInvocation> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(PodmanArtifactRuntime, Object.assign({}, config(), patch))
  const bytes = Buffer.from(html)
  const revision = {
    artifactId: randomUUID(),
    revisionId: randomUUID(),
    workspaceId: 'qualification',
    sessionId: 'publisher',
    operationId: randomUUID(),
    parent: null,
    restoredFrom: null,
    title: 'Qualification',
    entry: 'index.html',
    profile,
    capabilities: profile === 'document' ? ['published-assets'] : ['published-assets', 'transient-input'],
    assets: [
      {
        name: 'index.html',
        mediaType,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        file: { attachmentId: randomUUID(), name: 'index.html', bytes: bytes.byteLength },
      },
    ],
    createdAt: new Date().toISOString(),
  } as unknown as ArtifactRevision
  const contents = [{ name: 'index.html', mediaType, data: bytes.toString('base64') }, ...extra]
  const assets = contents.map(content => ({
    name: content.name,
    mediaType: content.mediaType,
    sha256: createHash('sha256').update(Buffer.from(content.data, 'base64')).digest('hex'),
    file: {
      attachmentId: randomUUID() as ArtifactRevision['assets'][number]['file']['attachmentId'],
      name: content.name,
      bytes: Buffer.from(content.data, 'base64').byteLength,
    },
  }))
  const complete = { ...revision, assets } as ArtifactRevision
  const controller = new AbortController()
  return ctx.artifactRuntime.open(
    {
      revision: complete,
      assets: contents.map((content, index) => ({
        revision: complete,
        asset: complete.assets[index]!,
        data: content.data,
      })),
    },
    controller.signal,
  )
}
describe.skipIf(!qualified)('independent rootless artifact runtime', () => {
  it('renders authored HTML and accepts bounded input through a private pipe', async () => {
    const invocation = await open(
      '<button style="width:150px;height:80px" onclick="this.innerText=String(Number(this.innerText)+1)">0</button>',
    )
    expect((await invocation.interact(null)).text).toBe('0')
    expect((await invocation.interact({ type: 'pointer', x: 40, y: 40 })).text).toBe('1')
    await invocation.close()
    await invocation.ended
    await expect(invocation.interact({ type: 'text', text: 'late' })).rejects.toThrow('revoked')
  }, 60000)
  it('disables authored execution in the document profile', async () => {
    const invocation = await open(
      '<p>Document</p><script>document.body.innerText="EXECUTED"</script>',
      'document',
    )
    expect((await invocation.interact(null)).text).toBe('Document')
    await expect(invocation.interact({ type: 'key', key: 'Enter' })).rejects.toThrow('Document')
    await invocation.close()
  }, 60000)
  it('denies opaque-origin cookies, storage, parent DOM, Node, and network APIs while ordinary JavaScript runs', async () => {
    const invocation = await open(`<pre id="out"></pre><script>
    const result={javascript:'works',node:typeof process,require:typeof require};
    for(const [name,fn] of Object.entries({storage:()=>localStorage.getItem('secret'),cookie:()=>document.cookie,parent:()=>parent.document.body.innerText,indexed:()=>indexedDB.open('secret')})){try{fn();result[name]='ALLOWED'}catch{result[name]='DENIED'}}
    Promise.all(['http://127.0.0.1:3080','http://169.254.169.254/latest/meta-data/','file:///etc/passwd','https://example.com/','https://artifact.invalid/undisclosed.js'].map(async url=>{try{await fetch(url);return 'ALLOWED'}catch{return 'DENIED'}})).then(values=>{result.network=values;out.textContent=JSON.stringify(result)})
    </script>`)
    const first = await invocation.interact(null)
    const frame = first.text === '' ? await invocation.interact({ type: 'key', key: 'Tab' }) : first
    expect(JSON.parse(frame.text)).toEqual({
      javascript: 'works',
      node: 'undefined',
      require: 'undefined',
      storage: 'DENIED',
      cookie: 'DENIED',
      parent: 'DENIED',
      indexed: 'DENIED',
      network: ['DENIED', 'DENIED', 'DENIED', 'DENIED', 'DENIED'],
    })
    await invocation.close()
  }, 60000)
  it('renders Markdown and SVG without treating their bytes as authored HTML', async () => {
    const markdown = await open('# Report\n<script>steal()</script>', 'document', {}, 'text/markdown')
    expect((await markdown.interact(null)).text).toContain('Report')
    expect((await markdown.interact(null)).text).toContain('<script>steal()</script>')
    await markdown.close()
    const svg = await open(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>',
      'document',
      {},
      'image/svg+xml',
    )
    expect((await svg.interact(null)).png.length).toBeGreaterThan(100)
    await svg.close()
  }, 60000)
  it('renders a published PDF without executing its authored open action', async () => {
    const bytes = await readFile(new URL('./fixtures/document.pdf', import.meta.url))
    const invocation = await open(bytes, 'document', {}, 'application/pdf')
    expect((await invocation.interact(null)).text).toContain('Durable PDF')
    expect((await invocation.interact(null)).text).not.toContain('EXECUTED')
    await invocation.close()
  }, 60000)
  it('loads only explicitly published modules, styles, and JSON over virtual resource routes', async () => {
    const data = (text: string) => Buffer.from(text).toString('base64')
    const invocation = await open(
      '<link rel="stylesheet" href="style.css"><button id="counter">Loading</button><script type="module" src="app.js"></script>',
      'interactive-local',
      {},
      'text/html',
      [
        { name: 'style.css', mediaType: 'text/css', data: data('button{width:150px;height:80px}') },
        { name: 'data.json', mediaType: 'application/json', data: data('{"label":"Published"}') },
        {
          name: 'app.js',
          mediaType: 'text/javascript',
          data: data(
            'const config=await (await fetch("https://artifact.invalid/data.json")).json();counter.innerText=config.label;counter.onclick=()=>counter.innerText="Clicked";',
          ),
        },
      ],
    )
    expect((await invocation.interact(null)).text).toBe('Published')
    expect((await invocation.interact({ type: 'pointer', x: 40, y: 40 })).text).toBe('Clicked')
    await invocation.close()
  }, 60000)
  it('denies direct TCP and UDP egress against independent receivers with a working positive control', async () => {
    const command = promisify(execFile)
    const podman = async (...args: string[]) =>
      (await command('podman', args, { timeout: 15000, maxBuffer: 65536 })).stdout.trim()
    const sentinel = 'dsh-artifact-receiver-' + randomUUID()
    const directory = await mkdtemp(join(tmpdir(), 'artifact-authority-sentinels-'))
    const hostFile = join(directory, 'host-secret')
    const sessionFile = join(directory, 'session-secret')
    await writeFile(hostFile, 'HOST_SENTINEL')
    await writeFile(sessionFile, 'SESSION_SENTINEL')
    expect(await readFile(hostFile, 'utf8')).toBe('HOST_SENTINEL')
    expect(await readFile(sessionFile, 'utf8')).toBe('SESSION_SENTINEL')
    const server =
      "const fs=require('node:fs'),net=require('node:net'),dgram=require('node:dgram');let tcp=0,udp=0;const save=()=>fs.writeFileSync('/tmp/counts.json',JSON.stringify({tcp,udp}));const socket=dgram.createSocket('udp4');socket.on('message',()=>{udp++;save()});socket.bind(8889,'0.0.0.0',()=>{net.createServer(c=>{tcp++;save();c.end('HTTP/1.1 302 Found\\r\\nLocation: http://169.254.169.254/latest/meta-data/\\r\\nContent-Length: 0\\r\\n\\r\\n')}).listen(8888,'0.0.0.0',save)});"
    const counters = async () =>
      JSON.parse(
        await podman(
          'exec',
          sentinel,
          'node',
          '-e',
          "process.stdout.write(require('node:fs').readFileSync('/tmp/counts.json','utf8'))",
        ),
      ) as { tcp: number; udp: number }
    let invocation: ArtifactInvocation | undefined
    try {
      await podman(
        'run',
        '--detach',
        '--name',
        sentinel,
        '--network',
        'bridge',
        '--user',
        'pwuser',
        '--entrypoint',
        '/usr/bin/node',
        image!,
        '-e',
        server,
      )
      const inspections = JSON.parse(await podman('inspect', sentinel)) as {
        NetworkSettings: { Networks: Record<string, { IPAddress: string }> }
      }[]
      const inspection = inspections[0]!
      const address = Object.values(inspection.NetworkSettings.Networks)[0]!.IPAddress
      expect(address).toMatch(/^\d+\.\d+\.\d+\.\d+$/u)
      const probe = `const net=require('node:net'),dgram=require('node:dgram');Promise.all([new Promise(r=>{const s=net.connect(8888,${JSON.stringify(address)});s.setTimeout(1000);s.on('data',()=>{s.destroy();r('ALLOWED')});s.on('error',()=>r('DENIED'));s.on('timeout',()=>{s.destroy();r('DENIED')})}),new Promise(r=>{const s=dgram.createSocket('udp4');s.send(Buffer.from('sentinel'),8889,${JSON.stringify(address)},e=>{s.close();r(e?'DENIED':'SENT')})})]).then(x=>console.log(JSON.stringify(x)))`
      expect(
        JSON.parse(
          await podman(
            'run',
            '--rm',
            '--network',
            'bridge',
            '--user',
            'pwuser',
            '--entrypoint',
            '/usr/bin/node',
            image!,
            '-e',
            probe,
          ),
        ),
      ).toEqual(['ALLOWED', 'SENT'])
      await expect.poll(counters, { timeout: 5000 }).toEqual({ tcp: 1, udp: 1 })
      invocation = await open(
        `<p id="status">probe</p><script>const base=${JSON.stringify('http://' + address + ':8888')};fetch(base).catch(()=>{});try{navigator.sendBeacon(base,'data')}catch{};const image=new Image();image.src=base;try{new WebSocket(base.replace('http','ws'))}catch{};try{window.open(base)}catch{};const form=document.createElement('form');form.action=base;document.body.append(form);try{form.submit()}catch{};const peer=new RTCPeerConnection({iceServers:[{urls:'stun:'+${JSON.stringify(address)}+':8889'}]});peer.createDataChannel('probe');peer.createOffer().then(offer=>peer.setLocalDescription(offer)).then(()=>document.getElementById('status').textContent='attempted peer offer').catch(()=>document.getElementById('status').textContent='attempted peer denied');</script>`,
      )
      await expect
        .poll(async () => (await invocation!.interact({ type: 'key', key: 'Tab' })).text, { timeout: 10000 })
        .toContain('attempted peer')
      const engine = new DockerodePodmanEngine(socketPath!, 15000)
      const container = engine.getContainer('dsh-artifact-' + invocation.id)
      const direct = await container.runControl(['/usr/bin/node', '-e', probe], 65536)
      expect(direct.exitCode).toBe(0)
      expect(JSON.parse(direct.output)).toEqual(['DENIED', 'DENIED'])
      const authority = await container.runControl(
        [
          '/usr/bin/node',
          '-e',
          `const fs=require('node:fs');const files=${JSON.stringify([hostFile, sessionFile, '/workspace', '/var/run/docker.sock'])};console.log(JSON.stringify({files:files.map(p=>fs.existsSync(p)),credentials:Object.keys(process.env).filter(k=>/KEY|TOKEN|CREDENTIAL|SESSION|DSH_/u.test(k))}))`,
        ],
        65536,
      )
      expect(authority.exitCode).toBe(0)
      expect(JSON.parse(authority.output)).toEqual({ files: [false, false, false, false], credentials: [] })
      expect(await counters()).toEqual({ tcp: 1, udp: 1 })
      await invocation.close()
      await invocation.ended
      await expect(container.inspect()).rejects.toThrow()
    } finally {
      await invocation?.close()
      // The receiver may already have exited after a failed Engine allocation; cleanup remains idempotent.
      await podman('rm', '--force', sentinel).catch(() => {})
      await rm(directory, { recursive: true, force: true })
    }
  }, 60000)
  it('ends the preview at its lifetime limit and refuses stale interactions', async () => {
    const invocation = await open('<p>Ready</p>', 'interactive-local', { maxLifetimeMs: 5000 })
    expect((await invocation.interact(null)).text).toBe('Ready')
    await invocation.ended
    await expect(invocation.interact({ type: 'key', key: 'Tab' })).rejects.toThrow('revoked')
  }, 60000)
  it('rejects unknown privileged input through the executor', async () => {
    const invocation = await open('<p>Ready</p>')
    await expect(invocation.interact({ type: 'tool-call', name: 'bash' } as never)).rejects.toThrow()
    await expect(invocation.interact({ type: 'pointer', x: 640, y: 0 })).rejects.toThrow('outside')
    expect((await invocation.interact(null)).text).toBe('Ready')
    await invocation.close()
  }, 60000)
  it('denies background workers, persistent services and privileged browser APIs while local promises run', async () => {
    const invocation = await open(`<pre id="out"></pre><script>
    const result={local:'LOCAL_OK'};
    const probes={worker:()=>new Promise((resolve,reject)=>{const url=URL.createObjectURL(new Blob(['postMessage(1)'],{type:'text/javascript'}));const worker=new Worker(url);worker.onmessage=()=>{worker.terminate();URL.revokeObjectURL(url);resolve('EXECUTED')};worker.onerror=()=>{worker.terminate();URL.revokeObjectURL(url);reject(new Error('worker blocked'))}}),shared:()=>new SharedWorker('https://artifact.invalid/worker.js'),service:()=>navigator.serviceWorker.register('https://artifact.invalid/worker.js'),clipboard:()=>navigator.clipboard.writeText('untrusted'),media:()=>navigator.mediaDevices.getUserMedia({audio:true}),file:()=>window.showOpenFilePicker(),session:()=>sessionStorage.setItem('probe','secret')};
    Promise.all(Object.entries(probes).map(async([name,run])=>{try{const value=await run();value?.terminate?.();result[name]='ALLOWED'}catch{result[name]='DENIED'}})).then(()=>out.textContent=JSON.stringify(result));
    </script>`)
    let frame = await invocation.interact(null)
    await expect
      .poll(
        async () => {
          frame = await invocation.interact({ type: 'key', key: 'Tab' })
          return frame.text
        },
        { timeout: 10000 },
      )
      .not.toBe('')
    expect(JSON.parse(frame.text)).toEqual({
      local: 'LOCAL_OK',
      worker: 'DENIED',
      shared: 'DENIED',
      service: 'DENIED',
      clipboard: 'DENIED',
      media: 'DENIED',
      file: 'DENIED',
      session: 'DENIED',
    })
    await invocation.close()
  }, 60000)
  it('cannot retrieve another invocation asset, a Harness transport or encoded and queried resources', async () => {
    const marker = 'PRIVATE_' + randomUUID()
    const privateOwner = await open('<p>Private</p>', 'interactive-local', {}, 'text/html', [
      { name: 'private.json', mediaType: 'application/json', data: Buffer.from(marker).toString('base64') },
    ])
    const invocation = await open(`<pre id="out"></pre><script>
    Promise.all(['https://artifact.invalid/private.json','https://presentation.invalid/','https://artifact.invalid/index.html?query','https://artifact.invalid/%69ndex.html','http://127.0.0.1:3080/rpc'].map(async url=>{try{await fetch(url);return 'ALLOWED'}catch{return 'DENIED'}})).then(values=>out.textContent=JSON.stringify(values));
    </script>`)
    let frame = await invocation.interact(null)
    await expect
      .poll(
        async () => {
          frame = await invocation.interact({ type: 'key', key: 'Tab' })
          return frame.text
        },
        { timeout: 10000 },
      )
      .not.toBe('')
    expect(JSON.parse(frame.text)).toEqual(Array(5).fill('DENIED'))
    expect(frame.text).not.toContain(marker)
    await invocation.close()
    await privateOwner.close()
  }, 60000)
  it('terminates oversized authored output after a bounded successful initial frame', async () => {
    const invocation = await open(
      '<button style="width:150px;height:80px" onclick="document.body.innerText=String.fromCharCode(88).repeat(200000)">Ready</button>',
      'interactive-local',
      { maxOutputBytes: 100000 },
    )
    expect((await invocation.interact(null)).text).toBe('Ready')
    await expect(invocation.interact({ type: 'pointer', x: 40, y: 40 })).rejects.toThrow()
    await invocation.ended
    const engine = new DockerodePodmanEngine(socketPath!, 15000)
    await expect(engine.getContainer('dsh-artifact-' + invocation.id).inspect()).rejects.toThrow()
  }, 60000)
  it('cannot turn authored messages, top navigation, downloads or custom protocols into trusted effects', async () => {
    const invocation =
      await open(`<button style="width:150px;height:80px" onclick="run()">Local</button><pre id="out"></pre><script>
    function run(){const result={local:'LOCAL_OK'};parent.postMessage({type:'tool-call',name:'bash',input:{command:'forbidden'}},'*');parent.postMessage({sequence:0,png:'forged',text:'FORGED'},'*');for(const scheme of ['http://127.0.0.1:3080','file:///etc/passwd','dsh://approve']){try{top.location.href=scheme;result[scheme]='ALLOWED'}catch{result[scheme]='DENIED'}}result.popup=window.open('https://example.com/')===null?'DENIED':'ALLOWED';const link=document.createElement('a');link.href='data:text/plain,PRIVATE';link.download='untrusted.txt';link.click();out.textContent=JSON.stringify(result)}
    </script>`)
    expect((await invocation.interact(null)).text).toBe('Local')
    const frame = await invocation.interact({ type: 'pointer', x: 40, y: 40 })
    expect(JSON.parse(frame.text.slice(frame.text.indexOf('{')))).toEqual({
      local: 'LOCAL_OK',
      'http://127.0.0.1:3080': 'DENIED',
      'file:///etc/passwd': 'DENIED',
      'dsh://approve': 'DENIED',
      popup: 'DENIED',
    })
    expect(frame.invocationId).toBe(invocation.id)
    expect(frame.text).not.toContain('FORGED')
    await invocation.close()
    await invocation.ended
  }, 60000)
  it('contains memory exhaustion and removes the resource-limited invocation', async () => {
    await expect(
      open(
        '<script>const chunks=[];for(;;){const bytes=new Uint8Array(16*1024*1024);bytes.fill(1);chunks.push(bytes)}</script>',
        'interactive-local',
        { operationTimeoutMs: 5000 },
      ),
    ).rejects.toThrow()
    const engine = new DockerodePodmanEngine(socketPath!, 15000)
    expect(await engine.info()).toMatchObject({ Rootless: true, MemoryLimit: true })
  }, 60000)
  it('terminates CPU-bound hostile code under its operation deadline', async () => {
    const invocation = await open(
      '<button style="width:150px;height:80px" onclick="while(true){}">Ready</button>',
      'interactive-local',
      { operationTimeoutMs: 10000 },
    )
    expect((await invocation.interact(null)).text).toBe('Ready')
    await expect(invocation.interact({ type: 'pointer', x: 40, y: 40 })).rejects.toThrow('deadline')
    await invocation.ended
    const engine = new DockerodePodmanEngine(socketPath!, 15000)
    await expect(engine.getContainer('dsh-artifact-' + invocation.id).inspect()).rejects.toThrow()
  }, 60000)
})
