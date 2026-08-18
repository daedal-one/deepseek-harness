import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { AgentModelsSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AgentModelsKey } from './agent-locales.ts'
import css from './AgentsSection.module.css'

type Target = AgentModelsSnapshot['targets'][number]
type Model = AgentModelsSnapshot['models'][number]

/** Remote calls used by the Agents settings section. */
export interface AgentsSectionInjected {
  hooks: {
    /** Host role-directory revision, bound by the slot renderer. */
    agentDirectory: SnapshotStore<number>
  }
  list: () => Promise<AgentModelsSnapshot>
  save: (
    id: Target['id'],
    model: string,
    reasoningEffort: string | undefined,
    revision: number,
  ) => Promise<AgentModelsSnapshot>
  reset: (id: Target['id'], revision: number) => Promise<AgentModelsSnapshot>
  t: (key: AgentModelsKey) => string
}

/** Props assembled by the Settings slot renderer. */
export type AgentsSectionProps =
  PropsRuntime<'settings.section'> & InjectFace<AgentsSectionInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: AgentModelsSnapshot }

/** Extract a readable Remote failure without depending on a transport error class. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** One independently editable Agent card. */
function AgentCard({
  target,
  models,
  provider,
  writable,
  revision,
  save,
  reset,
  replace,
  t,
}: {
  target: Target
  models: readonly Model[]
  provider: string
  writable: boolean
  revision: number
  save: AgentsSectionInjected['save']
  reset: AgentsSectionInjected['reset']
  replace: (snapshot: AgentModelsSnapshot) => void
  t: AgentsSectionInjected['t']
}): ReactNode {
  const [modelId, setModelId] = useState(target.selection.model)
  const [effort, setEffort] = useState(target.selection.reasoningEffort ?? '')
  const [pending, setPending] = useState<'save' | 'reset' | undefined>()
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | undefined>()
  useEffect(() => {
    setModelId(target.selection.model)
    setEffort(target.selection.reasoningEffort ?? '')
  }, [target.selection.model, target.selection.reasoningEffort])
  const model = models.find(entry => entry.id === modelId)
  const efforts = model?.reasoningEfforts ?? []
  const normalizedEffort = efforts.some(entry => entry.id === effort) ? effort : ''
  const changed = modelId !== target.selection.model
    || normalizedEffort !== (target.selection.reasoningEffort ?? '')

  const run = (operation: Promise<AgentModelsSnapshot>, kind: 'save' | 'reset'): void => {
    setPending(kind)
    setFeedback(undefined)
    void operation.then(
      (snapshot) => {
        replace(snapshot)
        setFeedback({ text: t('saved'), error: false })
      },
      (error: unknown) => {
        const message = messageOf(error)
        setFeedback({ text: /revision|stale|changed/iu.test(message) ? t('stale') : message, error: true })
      },
    ).finally(() => { setPending(undefined) })
  }

  return (
    <li className={css.card} data-agent-id={target.id} data-overridden={target.overridden ? 'true' : undefined}>
      <div className={css.cardHeader}>
        <span className={css.identity}>
          <strong className={css.name}>{target.label}</strong>
          <span className={css.route}>{provider}</span>
        </span>
        <span className={css.tag}>{t(target.overridden ? 'overrideTag' : 'defaultTag')}</span>
      </div>
      <div className={css.fields}>
        <label className={css.field}>
          <span>{t('model')}</span>
          <select
            className={css.selectInput}
            value={modelId}
            disabled={!writable || pending !== undefined}
            onChange={(event) => {
              const next = event.currentTarget.value
              setModelId(next)
              const nextModel = models.find(entry => entry.id === next)
              if (!nextModel?.reasoningEfforts.some(entry => entry.id === effort)) setEffort('')
              setFeedback(undefined)
            }}
          >
            {models.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </label>
        <label className={css.field}>
          <span>{t('reasoning')}</span>
          <select
            className={css.selectInput}
            value={normalizedEffort}
            disabled={!writable || pending !== undefined || efforts.length === 0}
            onChange={(event) => { setEffort(event.currentTarget.value); setFeedback(undefined) }}
          >
            <option value="">{t('providerDefault')}</option>
            {efforts.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </label>
      </div>
      <div className={css.actions}>
        <button
          className={css.button}
          data-primary="true"
          type="button"
          disabled={!writable || !changed || pending !== undefined}
          onClick={() => { run(save(target.id, modelId, normalizedEffort || undefined, revision), 'save') }}
        >
          {pending === 'save' ? t('applying') : t('apply')}
        </button>
        {target.overridden ? (
          <button
            className={css.button}
            type="button"
            disabled={!writable || pending !== undefined}
            onClick={() => { run(reset(target.id, revision), 'reset') }}
          >
            {pending === 'reset' ? t('resetting') : t('reset')}
          </button>
        ) : null}
        {feedback === undefined ? null : (
          <span className={css.feedback} data-error={feedback.error ? 'true' : undefined} role="status">
            {feedback.text}
          </span>
        )}
      </div>
    </li>
  )
}

/** Render the graphical per-Agent model settings page. */
export function AgentsSection(props: AgentsSectionProps): ReactNode {
  const { list, save, reset, t, useAgentDirectory } = props
  const directoryRevision = useAgentDirectory(value => value)
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  useEffect(() => {
    let current = true
    setState(previous => previous.status === 'ready' ? previous : { status: 'loading' })
    void list().then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [directoryRevision, list, request])
  const replace = useCallback((snapshot: AgentModelsSnapshot): void => {
    setState({ status: 'ready', snapshot })
  }, [])
  if (state.status === 'loading') return <p className={css.status}>{t('loading')}</p>
  if (state.status === 'error') {
    return (
      <div className={css.section}>
        <p className={css.status} role="alert">{t('loadFailed')}</p>
        <button className={css.button} type="button" onClick={() => { setRequest(value => value + 1) }}>
          {t('retry')}
        </button>
      </div>
    )
  }
  const { snapshot } = state
  return (
    <section className={css.section}>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      {!snapshot.writable ? <p className={css.notice}>{t('readOnly')}</p> : null}
      <h3 className={css.heading}>{t('liveAgents')}</h3>
      <ul className={css.cards}>
        {snapshot.targets.map(target => (
          <AgentCard
            key={String(target.id)}
            target={target}
            models={snapshot.models}
            provider={snapshot.provider}
            writable={snapshot.writable}
            revision={snapshot.revision}
            save={save}
            reset={reset}
            replace={replace}
            t={t}
          />
        ))}
      </ul>
    </section>
  )
}
