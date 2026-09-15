/**
 * Browser-safe failure vocabulary of the configuration surfaces this package
 * serves. The redacted views themselves live with their seam in
 * `@deepseek-ai/dsh-settings/types`, whose Cordis event declarations already
 * register that file for the Client compilation face.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials/types'

/** Identity of one browser account sign-in. */
export type AccountAttemptId = Branded<'AccountAttemptId'>
/** Identity of one question within an account sign-in. */
export type AccountPromptId = Branded<'AccountPromptId'>

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /**
     * Every seam refusal that is not a stale write: an unregistered or malformed
     * namespace, a read-only provider, schema validation, storage.
     */
    'settings/rejected': { readonly ns: string }
    /**
     * The stored revision moved after the caller read it. Its own outcome rather
     * than an invalid request: the caller must re-read and re-apply.
     */
    'settings/conflict': { readonly ns: string; readonly expected: number; readonly actual: number }
    /**
     * The provider refused a valid credential write, for example because a
     * read-only source shadows the reference. The details name only the
     * reference, never the value.
     */
    'credential/rejected': { readonly ref: string }
  }
}

/** Confirmation that the settings document was handed to the native editor. */
export interface SettingsDocumentOpenValue {
  readonly opened: true
}

/** Result of opening or revealing one locally authored Agent preset directory. */
export type AgentPresetDirectoryOpenValue =
  | { readonly opened: true }
  | { readonly opened: false; readonly path: string }

/** One provider account, with credential presence but no credential values. */
export interface ProviderAccount {
  readonly key: CredentialKey
  readonly label: string
  readonly methods: readonly { readonly id: string; readonly label: string }[]
  readonly configured: boolean
  readonly inFlight: boolean
}

/** One question presented during provider sign-in. Answers are write-only. */
export interface ProviderAccountPrompt {
  readonly id: AccountPromptId
  readonly kind: 'text' | 'secret' | 'select'
  readonly message: string
  readonly placeholder?: string
  readonly options?: readonly { readonly id: string; readonly label: string; readonly description?: string }[]
}

/** Redacted sign-in progress carried by a cancellable Remote stream. */
export interface ProviderAccountUpdate {
  readonly id: AccountAttemptId
  readonly status: 'pending' | 'authorized' | 'cancelled' | 'failed'
  readonly message?: string
  readonly url?: string | undefined
  readonly code?: string
  readonly prompt?: ProviderAccountPrompt | undefined
}
