/** The transcript width handles belong to the shared content-width axis, which only the Chat View elects. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const skeleton = readFileSync(
  fileURLToPath(new URL('../src/client/skeleton/ConversationRoot.module.css', import.meta.url)),
  'utf8',
)

describe('conversation width handles', () => {
  it('hides the strips for every View that does not elect the shared width axis', () => {
    const rule = skeleton.match(
      /\.root:not\(:has\(\[data-conversation-width-axis\]\)\)\s+\.widthHandle\s*\{[^}]*\}/,
    )?.[0]
    expect(rule).toMatch(/display: none;/)
  })

  it('does not key handle visibility on the composer overlay', () => {
    // Trajectory and terminal elect the composer overlay; prompt and info own
    // full-bleed scrollers without it, so the overlay never covered them all.
    expect(skeleton).not.toMatch(/\.root:has\(\[data-conversation-composer-overlay\]\)\s+\.widthHandle/)
  })
})
