/** Spend view: the OpenRouter key's spend and limit plus the session's estimated cost. */
import { useEffect, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsStore } from '@deepseek-ai/dsh-client-store'
import type {
  OpenRouterKeyUsage,
  OpenRouterSessionSpend,
  OpenRouterSpendFailure,
} from '@deepseek-ai/dsh-openrouter-spend/types'
import { formatUsd, formatUsdOptional } from './format.ts'
import type { SpendKey } from './locales.ts'
import { createSpendStore, type SpendViewState } from './store.ts'
import css from './SpendView.module.css'

type Translate = (key: SpendKey, params?: Record<string, unknown>) => string

/**
 * Registration-side face of the Spend view: one plain data-read trigger.
 * The framework bakes the store's `actions` into the inject factory, so this
 * face carries only the callback the component itself receives.
 */
export interface SpendViewInjected {
  /** Read the current spend reading; aborts any in-flight read. */
  load: () => void
}

/** Full component props assembled by the conversation view slot renderer. */
export type SpendViewProps =
  PropsRuntime<'conversation.view'>
  & PropsStore<ReturnType<typeof createSpendStore>>
  & InjectFace<SpendViewInjected>
  & PropsLocale<'spend'>

const FAILURE_KEYS = {
  'not-configured': 'failure.not-configured',
  'unauthorized': 'failure.unauthorized',
  'rate-limited': 'failure.rate-limited',
  'unreachable': 'failure.unreachable',
  'malformed-response': 'failure.malformed-response',
} as const satisfies Record<OpenRouterSpendFailure['reason'], SpendKey>

/** One labeled amount row. */
function AmountRow({ label, value }: { readonly label: string, readonly value: ReactNode }): ReactNode {
  return (
    <div className={css.row}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

/** The key spend block over one settled reading. */
function KeySpend({ usage, t }: { readonly usage: OpenRouterKeyUsage, readonly t: Translate }): ReactNode {
  return (
    <section className={css.block}>
      <header className={css.blockHeader}>
        <h2>{t('heading.key')}</h2>
        <span className={css.keyMeta}>
          {usage.label}
          {usage.isFreeTier ? <span className={css.tag}>{t('tag.freeTier')}</span> : null}
        </span>
      </header>
      <dl className={css.rows}>
        <AmountRow label={t('row.total')} value={formatUsd(t, usage.usageUsd)} />
        <AmountRow label={t('row.daily')} value={formatUsd(t, usage.usageDailyUsd)} />
        <AmountRow label={t('row.weekly')} value={formatUsd(t, usage.usageWeeklyUsd)} />
        <AmountRow label={t('row.monthly')} value={formatUsd(t, usage.usageMonthlyUsd)} />
        <AmountRow label={t('row.limitConfigured')} value={formatUsdOptional(t, usage.limitUsd)} />
        <AmountRow
          label={t('row.limitRemaining')}
          value={formatUsdOptional(t, usage.limitUsd === null ? null : usage.limitRemainingUsd)}
        />
      </dl>
    </section>
  )
}

/** The session estimate block over one settled reading. */
function SessionEstimate({
  session,
  t,
}: {
  readonly session: OpenRouterSessionSpend | null
  readonly t: Translate
}): ReactNode {
  return (
    <section className={css.block}>
      <h2>{t('heading.session')}</h2>
      {session === null ? null : (
        <>
          <p className={css.sessionModel}>
            <code>{session.model}</code>
            <span className={css.sessionProvider}>{session.provider}</span>
          </p>
          <p className={css.sessionValue}>
            {session.costUsd === null
              ? t('session.unpriceable')
              : formatUsd(t, session.costUsd)}
          </p>
        </>
      )}
    </section>
  )
}

/** The localized primary message for one host-reported failure reason. */
function failureMessage(failure: OpenRouterSpendFailure, t: Translate): string {
  return t(FAILURE_KEYS[failure.reason])
}

/**
 * Render the spend reading in its in-flight, settled, or failed state.
 * The view owns no timers: it reads when it mounts and on every explicit
 * refresh, and the injected read is the only mutation path.
 * @param props - the slot renderer's composed props.
 * @returns the rendered view body.
 */
export function SpendView({ load, useStore, t }: SpendViewProps): ReactNode {
  const state: SpendViewState = useStore(store => store)

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className={css.root} aria-busy={state.status === 'loading'}>
      {state.status === 'loading' ? <p className={css.status}>{t('state.loading')}</p> : null}
      {state.status === 'failed' ? (
        <div className={css.failure}>
          <p role="alert">{failureMessage(state.failure, t)}</p>
          <p className={css.failureDetail}>{state.failure.detail}</p>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <div className={css.content}>
          <KeySpend usage={state.snapshot.key} t={t} />
          <SessionEstimate session={state.snapshot.session} t={t} />
          <p className={css.meta}>{t('detail.fetchedAt', { time: new Date(state.snapshot.fetchedAt).toLocaleString() })}</p>
        </div>
      ) : null}
      <button type="button" className={css.refresh} onClick={() => { load() }}>{t('action.refresh')}</button>
    </div>
  )
}
