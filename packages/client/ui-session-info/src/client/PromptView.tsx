/**
 * Prompt view: the Session's rendered system prompt and its complete tool
 * catalog in one searchable reading.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsStore } from '@deepseek-ai/dsh-client-store'
import type { SessionPromptTool } from '@deepseek-ai/dsh-session-info/types'
import type { SessionInfoKey } from './locales.ts'
import {
  countOccurrences,
  filterTools,
  formatSchema,
  parameterRows,
  promptStats,
  type PromptParameterRow,
} from './prompt-format.ts'
import { createPromptStore, type PromptViewState } from './prompt-store.ts'
import css from './PromptView.module.css'

type Translate = (key: SessionInfoKey, params?: Record<string, unknown>) => string

/**
 * Registration-side face of the Prompt view: one read trigger.
 * The framework bakes the store's `actions` into the inject factory, so this
 * face carries only the callback the component itself receives.
 */
export interface PromptViewInjected {
  /** Read the Session's prompt reading; aborts any in-flight read. */
  loadPrompt: () => void
}

/** Full component props assembled by the conversation view slot renderer. */
export type PromptViewProps =
  PropsRuntime<'conversation.view'>
  & PropsStore<ReturnType<typeof createPromptStore>>
  & InjectFace<PromptViewInjected>
  & PropsLocale<'sessionInfo'>

/** One top-level parameter of a tool's argument schema. */
function ParameterRow({ row, t }: { readonly row: PromptParameterRow; readonly t: Translate }): ReactNode {
  return (
    <div className={css.parameter}>
      <dt>
        <code>{row.name}</code>
        <span className={css.tag}>{row.type ?? t('parameter.noType')}</span>
        {row.required ? <span className={css.required}>{t('parameter.required')}</span> : null}
      </dt>
      <dd>{row.description ?? t('value.none')}</dd>
    </div>
  )
}

/** One tool: its identity, description, parameter rows, and raw argument schema. */
function ToolCard({ tool, t }: { readonly tool: SessionPromptTool; readonly t: Translate }): ReactNode {
  const rows = parameterRows(tool.parameters)
  return (
    <li className={css.tool}>
      <div className={css.toolHeader}>
        <code className={css.toolName}>{tool.name}</code>
        <span className={css.meta}>{t('tool.parameters', { count: rows.length })}</span>
      </div>
      <p className={css.toolDescription}>{tool.description}</p>
      {rows.length === 0
        ? <p className={css.muted}>{t('tool.noParameters')}</p>
        : (
          <details className={css.disclosure}>
            <summary>{t('tool.parametersHeading')}</summary>
            <dl className={css.parameters}>
              {rows.map(row => <ParameterRow key={row.name} row={row} t={t} />)}
            </dl>
          </details>
        )}
      <details className={css.disclosure}>
        <summary>{t('tool.schemaHeading')}</summary>
        <pre className={css.schema}>{formatSchema(tool.parameters)}</pre>
      </details>
    </li>
  )
}

/**
 * Render the Session's model-visible prompt state with a search box over the
 * system prompt and the tool catalog. The view owns no timers: it reads when
 * it mounts and on every explicit refresh, and the injected read is the only
 * mutation path.
 * @param props - the slot renderer's composed props.
 * @returns the rendered view body.
 */
export function PromptView({ loadPrompt, useStore, t }: PromptViewProps): ReactNode {
  const state: PromptViewState = useStore(store => store)
  const [query, setQuery] = useState('')

  useEffect(() => {
    loadPrompt()
  }, [loadPrompt])

  const reading = state.prompt
  const snapshot = reading.status === 'ready' ? reading.snapshot : undefined
  const tools = snapshot?.tools ?? []
  const shown = useMemo(() => filterTools(tools, query), [tools, query])
  const stats = promptStats(snapshot?.systemPrompt ?? '')

  return (
    <div className={css.root} aria-busy={reading.status === 'loading'}>
      <div className={css.toolbar}>
        {snapshot === undefined ? null : (
          <>
            <input
              type="search"
              className={css.search}
              aria-label={t('search.label')}
              placeholder={t('search.placeholder')}
              value={query}
              onChange={(event) => { setQuery(event.target.value) }}
            />
            <span className={css.count}>{t('search.count', { shown: shown.length, total: tools.length })}</span>
          </>
        )}
        <button type="button" className={css.refresh} onClick={loadPrompt}>{t('action.refresh')}</button>
      </div>
      {reading.status === 'loading' ? <p className={css.status}>{t('prompt.loading')}</p> : null}
      {reading.status === 'failed' ? (
        <div className={css.failure}>
          <p role="alert">{t('failure.session-unavailable')}</p>
        </div>
      ) : null}
      {snapshot === undefined ? null : (
        <div className={css.content}>
          {snapshot.model === null
            ? null
            : <p className={css.model}>{t('prompt.model', { provider: snapshot.model.provider, model: snapshot.model.model })}</p>}
          <section className={css.block}>
            <div className={css.blockHeader}>
              <h2>{t('heading.systemPrompt')}</h2>
              <span className={css.meta}>{t('prompt.stats', { lines: stats.lines, characters: stats.characters })}</span>
            </div>
            {snapshot.systemPrompt === ''
              ? <p className={css.muted}>{t('prompt.none')}</p>
              : <pre className={css.prompt}>{snapshot.systemPrompt}</pre>}
            {query.trim() === ''
              ? null
              : <p className={css.meta}>{t('prompt.matches', { count: countOccurrences(snapshot.systemPrompt, query) })}</p>}
          </section>
          <section className={css.block}>
            <div className={css.blockHeader}>
              <h2>{t('heading.tools')}</h2>
              <span className={css.meta}>{t('tools.count', { count: tools.length })}</span>
            </div>
            {tools.length === 0 ? <p className={css.muted}>{t('tools.none')}</p> : null}
            {tools.length > 0 && shown.length === 0 ? <p className={css.muted}>{t('tools.noMatches')}</p> : null}
            {shown.length === 0 ? null : (
              <ul className={css.tools}>
                {shown.map(tool => <ToolCard key={tool.name} tool={tool} t={t} />)}
              </ul>
            )}
          </section>
          <p className={css.meta}>{t('detail.promptReadAt', { time: new Date(snapshot.readAt).toLocaleString() })}</p>
        </div>
      )}
    </div>
  )
}
