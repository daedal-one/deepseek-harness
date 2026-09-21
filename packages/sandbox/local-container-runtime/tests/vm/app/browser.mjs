import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:8080')
  const before = Number(await page.locator('#counter').textContent())
  await page.getByRole('button', { name: 'Increment' }).click()
  await page.waitForFunction(value => Number(document.querySelector('#counter').textContent) === value, before + 1)
  const echoed = await page.evaluate(() => new Promise((resolve, reject) => {
    const socket = new WebSocket('ws://127.0.0.1:8080')
    socket.onopen = () => socket.send('vm-browser-ok')
    socket.onmessage = event => { socket.close(); resolve(event.data) }
    socket.onerror = reject
  }))
  if (echoed !== 'vm-browser-ok') throw new Error('WebSocket echo mismatch')
  console.log(JSON.stringify({ before, after: before + 1, websocket: echoed }))
} finally { await browser.close() }
