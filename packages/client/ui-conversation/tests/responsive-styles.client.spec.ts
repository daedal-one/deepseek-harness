/** Phone conversation geometry reserves navigation and visible-viewport space. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const skeleton = readFileSync(fileURLToPath(new URL('../src/client/skeleton/ConversationRoot.module.css', import.meta.url)), 'utf8')
const chat = readFileSync(fileURLToPath(new URL('../src/client/chat/ChatView.module.css', import.meta.url)), 'utf8')

describe('conversation responsive styles', () => {
  it('keeps phone chrome, composer, and transcript inside the visible viewport', () => {
    expect(skeleton).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.root\s*\{[\s\S]*?min-height: 100dvh;[\s\S]*?height: auto;/)
    const phoneChatFlow = skeleton.match(
      /\.root \.scrollBody:not\(:has\(\[data-conversation-composer-overlay\]\)\)\s*\{[^}]*\}/,
    )?.[0]
    expect(phoneChatFlow).toMatch(/overflow-x: clip;[\s\S]*?overflow-y: visible;/)
    expect(skeleton).toMatch(/\.header\s*\{\s*padding: 10px 12px 0 64px;/)
    expect(skeleton).toMatch(/\.tabs\s*\{[\s\S]*?overflow-x: auto;/)
    expect(skeleton).toMatch(/\.composerSeat\s*\{\s*padding-bottom: env\(safe-area-inset-bottom\);/)
    expect(chat).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.scroll\s*\{\s*padding-right: 12px;\s*padding-left: 12px;/)
  })
})
