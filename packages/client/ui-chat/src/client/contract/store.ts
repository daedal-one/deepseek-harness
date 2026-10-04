/** Chat-owned per-Session view state. */

/** Tool call identity as carried by Chat nodes. */
export type ToolCallId = string

/** One manually expanded Turn process generation. */
export interface TurnProcessViewEntry {
  readonly turn: number
  /** Null identifies the live activity-summary process, before an answer settles. */
  readonly answerStep: number | null
}

/** Per-Session state shared only by the Chat view and details surface. */
export interface ChatStoreState {
  turnProcesses: TurnProcessViewEntry[]
}
