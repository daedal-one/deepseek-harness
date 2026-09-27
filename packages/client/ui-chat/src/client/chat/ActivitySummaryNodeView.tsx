import { memo } from 'react'
import { IconChecklistOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeViewProps } from '../contract/slots.ts'
import css from './ActivitySummaryNodeView.module.css'

/** Latest model-generated activity status for the owning Turn. */
export const ActivitySummaryNodeView = memo(function ActivitySummaryNodeView({
  node, t,
}: ChatNodeViewProps<'activity-summary'>) {
  return (
    <div
      className={css.root}
      role="status"
      aria-label={t('message.activitySummary.label')}
      data-activity-summary-turn={node.data.turn}
      data-activity-summary-revision={node.data.revision}
      data-activity-summary-through={node.data.throughSeq}
    >
      <IconChecklistOutline14 className={css.icon} />
      <div className={css.lines}>
        {node.data.lines.map((line, index) => <div key={index}>{line}</div>)}
      </div>
    </div>
  )
})
