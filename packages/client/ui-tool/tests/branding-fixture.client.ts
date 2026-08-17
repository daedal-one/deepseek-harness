/** Static branding source for tool assembly tests outside the full Web roster. */
const SNAPSHOT = Object.freeze({ name: 'the harness', revision: 0 })

/** Minimal observable face required by ui-conversation. */
export const TEST_BRANDING = {
  getSnapshot: () => SNAPSHOT,
  subscribe: (): (() => void) => () => {},
}
