/** Info view: conversation summary, Session identity, workspace, environment, command-authorization policy, and spend. */
import { useEffect, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsStore } from '@deepseek-ai/dsh-client-store'
import type {
  OpenRouterKeyUsage,
  OpenRouterSessionSpend,
  OpenRouterSpendFailure,
} from '@deepseek-ai/dsh-openrouter-spend/types'
import type {
  SessionInfoPlacement,
  SessionInfoSnapshot,
} from '@deepseek-ai/dsh-session-info/types'
import { formatUsd, formatUsdOptional } from './format.ts'
import type { SessionInfoKey } from './locales.ts'
import { createInfoStore, type InfoSpendState, type InfoViewState } from './store.ts'
import css from './InfoView.module.css'

type Translate = (key: SessionInfoKey, params?: Record<string, unknown>) => string

/**
 * Registration-side face of the Info view: one read trigger per Remote source.
 * The framework bakes the store's `actions` into the inject factory, so this
 * face carries only the callbacks the component itself receives.
 */
export interface InfoViewInjected {
  /** Read the Session Info snapshot; aborts any in-flight read. */
  loadInfo: () => void
  /** Read the OpenRouter spend snapshot; aborts any in-flight read. */
  loadSpend: () => void
}

/** Full component props assembled by the conversation view slot renderer. */
export type InfoViewProps =
  PropsRuntime<'conversation.view'>
  & PropsStore<ReturnType<typeof createInfoStore>>
  & InjectFace<InfoViewInjected>
  & PropsLocale<'sessionInfo'>

const PLACEMENT_KEYS = {
  host: 'placement.host',
  container: 'placement.container',
  external: 'placement.external',
  unknown: 'placement.unknown',
} as const satisfies Record<SessionInfoPlacement, SessionInfoKey>

const SPEND_FAILURE_KEYS = {
  'not-configured': 'failure.not-configured',
  'unauthorized': 'failure.unauthorized',
  'rate-limited': 'failure.rate-limited',
  'unreachable': 'failure.unreachable',
  'malformed-response': 'failure.malformed-response',
} as const satisfies Record<OpenRouterSpendFailure['reason'], SessionInfoKey>

/** One labeled fact row. */
function Row({ label, value }: { readonly label: string; readonly value: ReactNode }): ReactNode {
  return (
    <div className={css.row}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

/** A nullable fact rendered through one unavailable/none wording rather than a fabricated value. */
function optional(value: string | null, t: Translate): ReactNode {
  return value === null ? t('value.unavailable') : <code>{value}</code>
}

/** The conversation summary block, or its stated absence. */
function SummaryBlock({ snapshot, t }: { readonly snapshot: SessionInfoSnapshot; readonly t: Translate }): ReactNode {
  const summary = snapshot.summary
  return (
    <section className={css.block}>
      <h2>{t('heading.summary')}</h2>
      {summary === null
        ? <p className={css.muted}>{t('summary.none')}</p>
        : <p className={css.summary}>{summary}</p>}
    </section>
  )
}

/** The Session identity block. */
function SessionBlock({ snapshot, t }: { readonly snapshot: SessionInfoSnapshot; readonly t: Translate }): ReactNode {
  const session = snapshot.session
  return (
    <section className={css.block}>
      <h2>{t('heading.session')}</h2>
      <dl className={css.rows}>
        <Row label={t('row.sessionId')} value={<code>{session.sessionId}</code>} />
        <Row label={t('row.title')} value={session.title ?? t('value.none')} />
        <Row label={t('row.agentPreset')} value={session.agentPreset ?? t('value.none')} />
        <Row
          label={t('row.model')}
          value={session.model === null
            ? t('model.none')
            : <span><code>{session.model.model}</code> <span className={css.muted}>{session.model.provider}</span></span>}
        />
        <Row label={t('row.cwd')} value={session.cwd === null ? t('value.none') : <code>{session.cwd}</code>} />
        <Row label={t('row.turns')} value={String(session.turns)} />
        <Row label={t('row.steps')} value={String(session.steps)} />
      </dl>
    </section>
  )
}

/** The registered Workspace block, or its explicit absence. */
function WorkspaceBlock({ snapshot, t }: { readonly snapshot: SessionInfoSnapshot; readonly t: Translate }): ReactNode {
  const workspace = snapshot.workspace
  return (
    <section className={css.block}>
      <h2>{t('heading.workspace')}</h2>
      {workspace === null
        ? <p className={css.muted}>{t('workspace.none')}</p>
        : (
          <dl className={css.rows}>
            <Row label={t('workspace.path')} value={<code>{workspace.path}</code>} />
            <Row label={t('workspace.title')} value={workspace.title} />
            <Row label={t('workspace.id')} value={<code>{workspace.workspaceId}</code>} />
          </dl>
        )}
    </section>
  )
}

/** The Host process and execution-placement block. */
function EnvironmentBlock({ snapshot, t }: { readonly snapshot: SessionInfoSnapshot; readonly t: Translate }): ReactNode {
  const environment = snapshot.environment
  return (
    <section className={css.block}>
      <h2>{t('heading.environment')}</h2>
      <dl className={css.rows}>
        <Row label={t('env.placement')} value={t(PLACEMENT_KEYS[environment.placement])} />
        <Row label={t('env.environmentId')} value={optional(environment.environmentId, t)} />
        <Row label={t('env.platform')} value={<code>{`${environment.platform} · ${environment.arch}`}</code>} />
        <Row label={t('env.release')} value={environment.release} />
        <Row label={t('env.node')} value={<code>{environment.node}</code>} />
        <Row label={t('env.home')} value={<code>{environment.home}</code>} />
      </dl>
    </section>
  )
}

/** The command-authorization policy block. */
function PoliciesBlock({ snapshot, t }: { readonly snapshot: SessionInfoSnapshot; readonly t: Translate }): ReactNode {
  const policies = snapshot.policies
  const canChange = policies.canChangePermission === null
    ? t('value.unavailable')
    : (policies.canChangePermission ? t('value.yes') : t('value.no'))
  return (
    <section className={css.block}>
      <h2>{t('heading.policies')}</h2>
      <dl className={css.rows}>
        <Row label={t('policy.sandboxMode')} value={optional(policies.sandboxMode, t)} />
        <Row label={t('policy.sandboxDefault')} value={optional(policies.sandboxDefault, t)} />
        <Row label={t('policy.workspaceRoot')} value={optional(policies.workspaceRoot, t)} />
        <Row label={t('policy.approvalPolicy')} value={optional(policies.approvalPolicy, t)} />
        <Row label={t('policy.approvalDefault')} value={optional(policies.approvalDefault, t)} />
        <Row label={t('policy.preset')} value={optional(policies.permissionPreset, t)} />
        {policies.permissionPresetDescription === null
          ? null
          : <Row label={t('policy.presetDescription')} value={policies.permissionPresetDescription} />}
        <Row label={t('policy.canChange')} value={canChange} />
      </dl>
    </section>
  )
}

/** The key spend rows over one settled reading. */
function KeySpend({ usage, t }: { readonly usage: OpenRouterKeyUsage; readonly t: Translate }): ReactNode {
  return (
    <>
      <div className={css.blockHeader}>
        <h3>{t('spend.key')}</h3>
        <span className={css.keyMeta}>
          {usage.label}
          {usage.isFreeTier ? <span className={css.tag}>{t('spend.tag.freeTier')}</span> : null}
        </span>
      </div>
      <dl className={css.rows}>
        <Row label={t('spend.row.total')} value={formatUsd(t, usage.usageUsd)} />
        <Row label={t('spend.row.daily')} value={formatUsd(t, usage.usageDailyUsd)} />
        <Row label={t('spend.row.weekly')} value={formatUsd(t, usage.usageWeeklyUsd)} />
        <Row label={t('spend.row.monthly')} value={formatUsd(t, usage.usageMonthlyUsd)} />
        <Row label={t('spend.row.limitConfigured')} value={formatUsdOptional(t, usage.limitUsd)} />
        <Row
          label={t('spend.row.limitRemaining')}
          value={formatUsdOptional(t, usage.limitUsd === null ? null : usage.limitRemainingUsd)}
        />
      </dl>
    </>
  )
}

/** The session spend estimate over one settled reading. */
function SessionEstimate({
  session,
  t,
}: {
  readonly session: OpenRouterSessionSpend | null
  readonly t: Translate
}): ReactNode {
  return (
    <div className={css.spendSession}>
      <h3>{t('spend.session')}</h3>
      {session === null ? null : (
        <>
          <p className={css.sessionModel}>
            <code>{session.model}</code>
            <span className={css.sessionProvider}>{session.provider}</span>
          </p>
          <p className={css.sessionValue}>
            {session.costUsd === null
              ? t('spend.sessionUnpriceable')
              : formatUsd(t, session.costUsd)}
          </p>
        </>
      )}
    </div>
  )
}

/** The spend block in its in-flight, settled, or failed state. */
function SpendBlock({ state, t }: { readonly state: InfoSpendState; readonly t: Translate }): ReactNode {
  return (
    <section className={css.block}>
      <h2>{t('heading.spend')}</h2>
      {state.status === 'loading' ? <p className={css.status}>{t('spend.loading')}</p> : null}
      {state.status === 'failed' ? (
        <p role="alert">{t(SPEND_FAILURE_KEYS[state.failure.reason])}</p>
      ) : null}
      {state.status === 'ready' ? (
        <>
          <KeySpend usage={state.snapshot.key} t={t} />
          <SessionEstimate session={state.snapshot.session} t={t} />
          <p className={css.meta}>{t('detail.spendFetchedAt', { time: new Date(state.snapshot.fetchedAt).toLocaleString() })}</p>
        </>
      ) : null}
    </section>
  )
}

/**
 * Render the Session Info reading with its nested spend reading.
 * The view owns no timers: it reads when it mounts and on every explicit
 * refresh, and the injected reads are the only mutation paths.
 * @param props - the slot renderer's composed props.
 * @returns the rendered view body.
 */
export function InfoView({ loadInfo, loadSpend, useStore, t }: InfoViewProps): ReactNode {
  const state: InfoViewState = useStore(store => store)

  useEffect(() => {
    loadInfo()
    loadSpend()
  }, [loadInfo, loadSpend])

  const refresh = (): void => {
    loadInfo()
    loadSpend()
  }

  return (
    <div className={css.root} aria-busy={state.info.status === 'loading'}>
      {state.info.status === 'loading' ? <p className={css.status}>{t('state.loading')}</p> : null}
      {state.info.status === 'failed' ? (
        <div className={css.failure}>
          <p role="alert">{t('failure.session-unavailable')}</p>
        </div>
      ) : null}
      {state.info.status === 'ready' ? (
        <div className={css.content}>
          <SummaryBlock snapshot={state.info.snapshot} t={t} />
          <SessionBlock snapshot={state.info.snapshot} t={t} />
          <WorkspaceBlock snapshot={state.info.snapshot} t={t} />
          <EnvironmentBlock snapshot={state.info.snapshot} t={t} />
          <PoliciesBlock snapshot={state.info.snapshot} t={t} />
          <SpendBlock state={state.spend} t={t} />
          <p className={css.meta}>{t('detail.readAt', { time: new Date(state.info.snapshot.readAt).toLocaleString() })}</p>
        </div>
      ) : null}
      <button type="button" className={css.refresh} onClick={refresh}>{t('action.refresh')}</button>
    </div>
  )
}
