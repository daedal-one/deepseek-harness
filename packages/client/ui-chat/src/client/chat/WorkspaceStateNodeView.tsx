import { memo } from 'react'
import type { ChatNodeViewProps } from '../contract/slots.ts'

/** Save progress and returned branches, independent of the coding agent's answer. */
export const WorkspaceStateNodeView = memo(function WorkspaceStateNodeView({ node, t }: ChatNodeViewProps<'workspace-state'>) {
  const { phase, branches, error } = node.data
  const label = phase === 'returned' ? 'workspace.returned' : phase === 'checkpointed' ? 'workspace.checkpointed' : phase === 'pending' ? 'workspace.pending' : 'workspace.saving'
  const commits = new Map<string, string[]>()
  for (const [branch, commit] of Object.entries(branches)) {
    const aliases = commits.get(commit) ?? []
    aliases.push(branch.replace(/^refs\/heads\//u, ''))
    commits.set(commit, aliases)
  }
  return <div role="status" data-workspace-phase={phase}>
    <p>{t(label)}</p>
    {phase === 'returned' && <ul>{[...commits].map(([commit, aliases]) => <li key={commit}>
      <code>{aliases[0]}</code>
      {aliases.length > 1 && <details><summary>{t('workspace.aliases', { count: aliases.length - 1 })}</summary>
        <ul>{aliases.slice(1).map(alias => <li key={alias}><code>{alias}</code></li>)}</ul>
      </details>}
    </li>)}</ul>}
    {error !== undefined && <details><summary>{t('workspace.details')}</summary><pre>{error}</pre></details>}
  </div>
})

/** Render durable execution waiting or failure.
 * @param props - admission node and localized copy.
 * @returns the admission status and optional error detail.
 */
export const WorkspaceAdmissionNodeView = memo(function WorkspaceAdmissionNodeView({ node, t }: ChatNodeViewProps<'workspace-admission'>) {
  return <div role="status" data-workspace-admission={node.data.status}>
    <p>{t(node.data.status === 'failed' ? 'workspace.admissionFailed' : 'workspace.waiting')}</p>
    {node.data.error !== undefined && <details><summary>{t('workspace.details')}</summary><pre>{node.data.error}</pre></details>}
  </div>
})
