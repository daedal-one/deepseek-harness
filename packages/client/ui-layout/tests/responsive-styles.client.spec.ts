/** Phone frame styles move resident panels out of the conversation grid. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/AppFrame.module.css', import.meta.url)), 'utf8')

describe('AppFrame responsive styles', () => {
  it('overlays sidebar and details while preserving a full-width center track', () => {
    expect(css).toMatch(/\.frame\[data-phone\]\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?height: 100dvh;/)
    expect(css).toMatch(/\.frame\[data-phone\] \.sidebarCol\s*\{[\s\S]*?position: absolute;[\s\S]*?width: min\(86vw, 320px\);/)
    expect(css).toMatch(/\.frame\[data-phone\] \.detailsCol\s*\{[\s\S]*?position: absolute;[\s\S]*?width: 100%;/)
    expect(css).toMatch(/\.frame\[data-phone\] \.drawerScrim\s*\{[\s\S]*?display: block;/)
  })
})
