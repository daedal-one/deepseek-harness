/**
 * Fail-closed durable operation event recorder.
 * @module @deepseek-ai/dsh-experimental-operation/recorder
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type {
  OperationJudgmentRequestEventData,
  OperationJudgmentResultEventData,
  OperationRunEndEventData,
  OperationRunStartEventData,
  OperationStepResultEventData,
  OperationStepStartEventData,
  OperationTransitionEventData,
} from './types.ts'

type OperationEventData = {
  'operation/run-start': OperationRunStartEventData
  'operation/step-start': OperationStepStartEventData
  'operation/step-result': OperationStepResultEventData
  'operation/judgment-request': OperationJudgmentRequestEventData
  'operation/judgment-result': OperationJudgmentResultEventData
  'operation/transition': OperationTransitionEventData
  'operation/run-end': OperationRunEndEventData
}

type OperationEventAppender = {
  append<Type extends keyof OperationEventData>(type: Type, data: OperationEventData[Type]): void
}

/**

 * Fail-closed recording boundary; any append or flush failure stops later work.

 */
export class OperationRecorder {
  /**
   * @param ctx Session owner used for every strict durability checkpoint.
   * @param session Calling agent's live session.
   */
  constructor(
    private readonly ctx: Context,
    private readonly session: Session,
  ) {}

  /**

   * Append one operation-owned log-only record.

   * @param type Event discriminant.

   * @param data Typed event payload.

   */
  append<Type extends keyof OperationEventData>(type: Type, data: OperationEventData[Type]): void {
    const session = this.session as unknown as OperationEventAppender
    session.append(type, data)
  }

  /**

   * Append and require a working persistence barrier before a following effect.

   * @param type Event discriminant.

   * @param data Typed event payload.

   */
  async appendAndFlush<Type extends keyof OperationEventData>(type: Type, data: OperationEventData[Type]): Promise<void> {
    this.append(type, data)
    await this.flush()
  }

  /**

   * Require every composed session persistence participant to acknowledge a barrier.

   */
  async flush(): Promise<void> {
    if (!await this.ctx.sessions.flush(this.session)) throw new OperationRecordingError('operation execution requires a composed session persistence flush barrier')
  }
}

/**

 * A durable-record append or barrier failed, so no following action may start.

 */
export class OperationRecordingError extends Error {
  /**
   * @param message Stable recording failure detail.
   */
  constructor(message: string) {
    super(message)
    this.name = 'OperationRecordingError'
  }
}
