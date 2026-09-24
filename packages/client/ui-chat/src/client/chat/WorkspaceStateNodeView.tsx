import { memo } from 'react'
import type { ChatNodeViewProps } from '../contract/slots.ts'

/** Save progress and returned branches, independent of the coding agent's answer. */
export const WorkspaceStateNodeView = memo(function WorkspaceStateNodeView({ node, t }: ChatNodeViewProps<'workspace-state'>) {
  const { phase, branches, repositories, error } = node.data
  const label = phase === 'returned' ? 'workspace.returned' : phase === 'checkpointed' ? 'workspace.checkpointed' : phase === 'pending' ? 'workspace.pending' : 'workspace.saving'
  const groups = (repositories ?? [{ remote: '', branches }]).map((repository) => {
    const commits = new Map<string, string[]>()
    for (const [branch, commit] of Object.entries(repository.branches)) {
      const aliases = commits.get(commit) ?? []
      aliases.push(branch.replace(/^refs\/heads\//u, ''))
      commits.set(commit, aliases)
    }
    return { repository: repository.remote, commits }
  })
  return <div role="status" data-workspace-phase={phase}>
    <p>{t(label)}</p>
    {phase === 'returned' && groups.map(group => <div key={group.repository}>
      {group.repository !== '' && <code>{group.repository}</code>}
      <ul>{[...group.commits].map(([commit, aliases]) => <li key={commit}>
        <code>{aliases[0]}</code>
        {aliases.length > 1 && <details><summary>{t('workspace.aliases', { count: aliases.length - 1 })}</summary>
          <ul>{aliases.slice(1).map(alias => <li key={alias}><code>{alias}</code></li>)}</ul>
        </details>}
      </li>)}</ul>
    </div>)}
    {error !== undefined && <details><summary>{t('workspace.details')}</summary><pre>{error}</pre></details>}
  </div>
})
