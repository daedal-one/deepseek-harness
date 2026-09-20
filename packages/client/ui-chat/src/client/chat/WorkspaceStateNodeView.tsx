import { memo } from 'react'
import type { ChatNodeViewProps } from '../contract/slots.ts'

/** Save progress and returned branches, independent of the coding agent's answer. */
export const WorkspaceStateNodeView = memo(function WorkspaceStateNodeView({ node, t }: ChatNodeViewProps<'workspace-state'>) {
  const { phase, branches, error } = node.data
  const label = phase === 'returned' ? 'workspace.returned' : phase === 'checkpointed' ? 'workspace.checkpointed' : phase === 'pending' ? 'workspace.pending' : 'workspace.saving'
  return <div role="status" data-workspace-phase={phase}>
    <p>{t(label)}</p>
    {phase === 'returned' && <ul>{Object.keys(branches).map(branch => <li key={branch}><code>{branch.replace(/^refs\/heads\//u, '')}</code></li>)}</ul>}
    {error !== undefined && <details><summary>{t('workspace.details')}</summary><pre>{error}</pre></details>}
  </div>
})
