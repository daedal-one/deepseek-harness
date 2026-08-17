import type { BrandingSnapshot } from '@deepseek-ai/dsh-client-ui-branding/client'

/** Static branding source for conversation package tests outside the full Web roster. */
const SNAPSHOT: BrandingSnapshot = Object.freeze({ name: 'the harness', revision: 0 })
export const TEST_BRANDING = {
  getSnapshot: (): BrandingSnapshot => SNAPSHOT,
  subscribe: (): (() => void) => () => {},
}

/** Provide the required branding service on a SlotTestRuntime-compatible host. */
export function provideTestBranding(runtime: { provide: (name: string, value: unknown) => void }): void {
  runtime.provide('branding', TEST_BRANDING)
}
