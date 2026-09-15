/** Browser adapters for Session identity, time zone and origin-local navigation. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionRequestId } from '../types.ts'
import type { SessionClientOptions, SessionPlatform, SessionSelection } from './platform.ts'
import { resolvedClientTimeZone } from './time-zone.ts'

/** Browser globals are sampled when each command is submitted. */
export const browserSessionPlatform: SessionPlatform = {
  createRequestId: () => randomUUID() as SessionRequestId,
  timeZone: resolvedClientTimeZone,
}

/**
 * Restore the browser origin's Session navigation and resolve its platform inputs.
 * @returns browser Session inputs with saved navigation restored.
 */
export function createBrowserSessionClientOptions(): SessionClientOptions {
  return {
    platform: browserSessionPlatform,
    selection: createSnapshotStore<SessionSelection>({}, { persist: { name: 'dsh.sessions.current' } }),
  }
}
