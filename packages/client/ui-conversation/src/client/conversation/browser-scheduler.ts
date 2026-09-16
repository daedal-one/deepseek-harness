/** Browser streaming publication cadence for Conversation bindings. */
import type { ConversationScheduler } from './binding.ts'

/**
 * Select the browser three-frame publication clock.
 * @returns the paint scheduler, or null where animation frames are unavailable.
 */
export function browserConversationScheduler(): ConversationScheduler | null {
  if (typeof requestAnimationFrame !== 'function') return null
  return {
    schedule(publish) {
      let remaining = 3
      let cancelled = false
      let frame = requestAnimationFrame(advance)
      function advance(): void {
        if (cancelled) return
        remaining--
        if (remaining === 0) publish()
        else frame = requestAnimationFrame(advance)
      }
      return () => {
        cancelled = true
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
      }
    },
  }
}
