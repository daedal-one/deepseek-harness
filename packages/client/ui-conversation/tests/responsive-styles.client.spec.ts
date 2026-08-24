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
    const floatingHeader = skeleton.match(
      /\.root\[data-phase='active'\] > \.headerFloat\s*\{[^}]*\}/,
    )?.[0]
    expect(floatingHeader).toMatch(/position: sticky;[\s\S]*?top: 0;[\s\S]*?background: var\(--dsw-alias-bg-base\);/)
    expect(floatingHeader).toMatch(/transition: transform var\(--ds-transition-duration\) var\(--ds-ease-in-out\);/)
    expect(skeleton).toMatch(/\.headerFloat\[data-scroll-hidden='true'\]\s*\{\s*transform: translateY\(-100%\);/)
    expect(skeleton).toMatch(/\.headerFloat:focus-within\s*\{\s*transform: translateY\(0\);\s*transition: none;/)
    expect(skeleton).toMatch(/prefers-reduced-motion: reduce[\s\S]*?\.headerFloat\s*\{\s*transition: none;/)
    expect(skeleton).toMatch(/\.header\s*\{\s*padding: 10px 12px 0 64px;/)
    expect(skeleton).toMatch(/\.tabs\s*\{[\s\S]*?overflow-x: auto;/)
    expect(skeleton).toMatch(/\.composerSeat\s*\{\s*padding-bottom: env\(safe-area-inset-bottom\);/)
    expect(chat).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.scroll\s*\{\s*padding-right: 12px;\s*padding-left: 12px;/)
  })
})
