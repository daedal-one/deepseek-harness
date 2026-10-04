/** Private trusted renderer process. Artifact JavaScript runs only in the sandboxed browser. */
import { createInterface } from 'node:readline'
import { chromium } from 'playwright'
import MarkdownIt from 'markdown-it'
import { readFile } from 'node:fs/promises'
let browser
let context
let page
let spec
let files
let surface
const escape = (text) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const markdown = new MarkdownIt({ html: false, linkify: false })
const pending = createInterface({ input: process.stdin, crlfDelay: Infinity })
for await (const line of pending) {
  try {
    const command = JSON.parse(line)
    if (command.type === 'open') {
      if (spec !== undefined) throw new Error('Renderer already initialized.')
      spec = command
      files = new Map(command.assets.map((asset) => [asset.name, asset]))
      const entry = files.get(command.entry)
      if (entry === undefined) throw new Error('No entry asset.')
      browser = await chromium.launch({
        chromiumSandbox: true,
        headless: true,
        timeout: command.timeoutMs,
        args: [
          '--disable-setuid-sandbox',
          '--disable-background-networking',
          '--disable-component-update',
          '--disable-sync',
          '--no-first-run',
        ],
      })
      context = await browser.newContext({
        javaScriptEnabled: command.profile === 'interactive-local' || entry.mediaType === 'application/pdf',
        acceptDownloads: false,
        serviceWorkers: 'block',
        viewport: { width: command.width, height: command.height },
        permissions: [],
      })
      page = await context.newPage()
      page.setDefaultTimeout(command.timeoutMs)
      context.on('page', (candidate) => {
        if (candidate !== page) void candidate.close()
      })
      page.on('dialog', (dialog) => {
        void dialog.dismiss()
      })
      page.on('download', (download) => {
        void download.cancel()
      })
      const entryUrl = 'https://artifact.invalid/' + command.entry
      const wrapperUrl = 'https://presentation.invalid/'
      const pdf = entry.mediaType === 'application/pdf'
      const pdfViewer =
        '<!doctype html><canvas></canvas><script type="module">import {getDocument,GlobalWorkerOptions} from "https://renderer.invalid/pdf.mjs";GlobalWorkerOptions.workerSrc="https://renderer.invalid/pdf.worker.mjs";const data=Uint8Array.from(atob(' +
        JSON.stringify(entry.data) +
        '),c=>c.charCodeAt(0));const doc=await getDocument({data,disableFontFace:true,isEvalSupported:false,useSystemFonts:false}).promise;for(let i=1;i<=doc.numPages;i++){const p=await doc.getPage(i);const canvas=i===1?document.querySelector("canvas"):document.body.appendChild(document.createElement("canvas"));const v=p.getViewport({scale:1});canvas.width=v.width;canvas.height=v.height;await p.render({canvasContext:canvas.getContext("2d"),viewport:v}).promise;const text=(await p.getTextContent()).items.map(item=>item.str??"").join(" ");const label=document.body.appendChild(document.createElement("p"));label.textContent=text;}document.body.dataset.ready="yes";</script>'
      const pdfModule = pdf ? await readFile('/opt/artifact/node_modules/pdfjs-dist/build/pdf.mjs') : null
      const pdfWorker = pdf
        ? await readFile('/opt/artifact/node_modules/pdfjs-dist/build/pdf.worker.mjs')
        : null
      await context.route('**/*', async (route) => {
        const request = route.request()
        let url
        try {
          url = new URL(request.url())
        } catch {
          await route.abort()
          return
        }
        if (
          url.href === wrapperUrl &&
          request.isNavigationRequest() &&
          request.frame() === page.mainFrame()
        ) {
          await route.fulfill({
            contentType: 'text/html',
            body:
              '<!doctype html><style>html,body{margin:0;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0}</style><iframe sandbox="' +
              (command.profile === 'interactive-local' || pdf ? 'allow-scripts' : '') +
              '" src="' +
              entryUrl +
              '"></iframe>',
            headers: {
              'Content-Security-Policy':
                "default-src 'none'; style-src 'unsafe-inline'; frame-src https://artifact.invalid; base-uri 'none'; form-action 'none'",
            },
          })
          return
        }
        if (
          pdf &&
          !request.isNavigationRequest() &&
          (url.href === 'https://renderer.invalid/pdf.mjs' ||
            url.href === 'https://renderer.invalid/pdf.worker.mjs')
        ) {
          await route.fulfill({
            contentType: 'text/javascript',
            body: url.pathname === '/pdf.mjs' ? pdfModule : pdfWorker,
            headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
          })
          return
        }
        if (
          url.origin !== 'https://artifact.invalid' ||
          url.search !== '' ||
          url.pathname.includes('%') ||
          (request.isNavigationRequest() && request.url() !== entryUrl)
        ) {
          await route.abort()
          return
        }
        const asset = files.get(url.pathname.slice(1))
        if (asset === undefined || request.method() !== 'GET') {
          await route.abort()
          return
        }
        let body = Buffer.from(asset.data, 'base64')
        let contentType = asset.mediaType
        if (request.isNavigationRequest()) {
          if (pdf) {
            body = Buffer.from(pdfViewer)
            contentType = 'text/html'
          } else if (asset.mediaType === 'text/markdown') {
            body = Buffer.from(markdown.render(body.toString('utf8')))
            contentType = 'text/html'
          } else if (asset.mediaType === 'image/svg+xml') {
            body = Buffer.from('<img alt="" src="data:image/svg+xml;base64,' + asset.data + '">')
            contentType = 'text/html'
          } else if (asset.mediaType.startsWith('image/')) {
            body = Buffer.from('<img alt="" src="data:' + asset.mediaType + ';base64,' + asset.data + '">')
            contentType = 'text/html'
          } else if (asset.mediaType !== 'text/html') {
            body = Buffer.from('<pre>' + escape(body.toString('utf8')) + '</pre>')
            contentType = 'text/html'
          }
        }
        await route.fulfill({
          status: 200,
          contentType,
          body,
          headers: {
            'Content-Security-Policy':
              "default-src 'none'; script-src https://artifact.invalid 'unsafe-inline'" +
              (pdf ? ' https://renderer.invalid' : '') +
              "; style-src https://artifact.invalid 'unsafe-inline'; img-src https://artifact.invalid data:; font-src https://artifact.invalid; connect-src https://artifact.invalid; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
          },
        })
      })
      await page.goto(wrapperUrl, { waitUntil: 'load', timeout: command.timeoutMs })
      surface = page.frameLocator('iframe')
      if (pdf) await surface.locator('body[data-ready="yes"]').waitFor({ timeout: command.timeoutMs })
    } else {
      if (spec === undefined || spec.profile !== 'interactive-local')
        throw new Error('Renderer does not accept interactions.')
      if (command.type === 'pointer') await page.mouse.click(command.x, command.y)
      else if (command.type === 'key') await page.keyboard.press(command.key)
      else if (command.type === 'text') await page.keyboard.insertText(command.text)
      else throw new Error('Unknown renderer command.')
    }
    const png = (await page.screenshot({ type: 'png', timeout: spec.timeoutMs })).toString('base64')
    const text = await surface.locator('body').innerText({ timeout: spec.timeoutMs })
    const response = JSON.stringify({
      sequence: command.sequence,
      png,
      text,
      width: spec.width,
      height: spec.height,
    })
    if (Buffer.byteLength(response) > spec.maxOutputBytes) throw new Error('Renderer output limit exceeded.')
    process.stdout.write(response + '\n')
  } catch (error) {
    process.stderr.write(
      'Artifact renderer refused the invocation: ' + String(error?.message ?? error).slice(0, 512) + '\n',
    )
    process.exitCode = 1
    break
  }
}
await browser?.close()
