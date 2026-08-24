/** Phone settings layout remains a full-viewport, independently scrolling surface. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SettingsRoot.module.css', import.meta.url)), 'utf8')

describe('SettingsRoot responsive styles', () => {
  it('stacks the panel and keeps section navigation horizontally reachable on phones', () => {
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.panel\s*\{[\s\S]*?flex-direction: column;[\s\S]*?height: 100dvh;/)
    expect(css).toMatch(/\.navList\s*\{[\s\S]*?flex-direction: row;[\s\S]*?overflow-x: auto;/)
    expect(css).toMatch(/\.options\s*\{[\s\S]*?padding: 0 16px max\(16px, env\(safe-area-inset-bottom\)\);/)
  })
})
