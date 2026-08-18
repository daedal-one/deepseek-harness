import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconChevronDownOutline14,
  IconSearchOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './PluginInventorySettingsTab.module.css'

/** Registration-side Remote face used by the section. */
export interface PluginInventorySettingsTabInjected {
  /** Read a current Host inventory snapshot. */
  list: () => Promise<PluginInventorySnapshot>
}

type PluginInventoryEntry = PluginInventorySnapshot['entries'][number]
type PluginFiberPhase = PluginInventoryEntry['fiberPhase']
type PluginStateFilter = 'all' | 'enabled' | 'disabled' | NonNullable<PluginFiberPhase> | 'unobserved'

/** Full component props assembled by the Settings slot renderer. */
export type PluginInventorySettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<PluginInventorySettingsTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: PluginInventorySnapshot }

const PHASE_KEYS = {
  pending: 'pending',
  loading: 'loadingPhase',
  active: 'active',
  failed: 'failed',
  unloading: 'unloading',
} satisfies Record<Exclude<PluginFiberPhase, null>, PluginInventoryLocaleKey>

const STATE_FILTER_KEYS = [
  ['all', 'allStates'],
  ['enabled', 'enabledTag'],
  ['disabled', 'disabledTag'],
  ['active', 'active'],
  ['pending', 'pending'],
  ['loading', 'loadingPhase'],
  ['failed', 'failed'],
  ['unloading', 'unloading'],
  ['unobserved', 'unobserved'],
] as const satisfies readonly (readonly [PluginStateFilter, PluginInventoryLocaleKey])[]

/** Localized accessible label for one root Fiber phase. */
function phaseLabel(
  phase: PluginFiberPhase,
  t: PluginInventorySettingsTabProps['t'],
): string {
  return phase === null ? t('unobserved') : t(PHASE_KEYS[phase])
}

/** Compact a module specifier without guessing whether its Loader id was generated. */
function moduleShortName(moduleName: string): string {
  const unscoped = moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName
  return unscoped
    .replace(/^cordis:/, '')
    .replace(/^cordis-plugin-/, '')
    .replace(/^dsh-(?:host-|client-)?/, '')
}

/** Whether an inventory row matches the local catalog query. */
function matches(entry: PluginInventoryEntry, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return true
  return [entry.moduleName, entry.entryId, entry.author, entry.description, entry.version]
    .filter((value): value is string => value !== null)
    .some(value => value.toLocaleLowerCase().includes(normalizedQuery))
}

/** Whether an inventory row matches the selected visible state. */
function matchesState(entry: PluginInventoryEntry, filter: PluginStateFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'enabled') return entry.enabled
  if (filter === 'disabled') return !entry.enabled
  return entry.enabled && (filter === 'unobserved'
    ? entry.fiberPhase === null
    : entry.fiberPhase === filter)
}

/** Render the read-only current Loader inventory. */
export function PluginInventorySettingsTab({ list, t }: PluginInventorySettingsTabProps): ReactNode {
  const catalogId = useId()
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [stateFilter, setStateFilter] = useState<PluginStateFilter>('all')
  const [expanded, setExpanded] = useState<PluginInventoryEntry['entryId'] | null>(null)
  const [state, setState] = useState<ViewState>({ status: 'loading' })

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => list()).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [list, request])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredEntries = useMemo(
    () => state.status === 'ready'
      ? state.snapshot.entries.filter(entry =>
        matches(entry, normalizedQuery) && matchesState(entry, stateFilter))
      : [],
    [normalizedQuery, state, stateFilter],
  )

  useEffect(() => {
    if (expanded !== null && !filteredEntries.some(entry => entry.entryId === expanded)) {
      setExpanded(null)
    }
  }, [expanded, filteredEntries])

  const retry = (): void => {
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }

  return (
    <div className={css.section} aria-busy={state.status === 'loading'}>
      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" onClick={retry}>{t('retry')}</button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <div className={css.catalog}>
          <div className={css.filters}>
            <label className={css.search}>
              <IconSearchOutline16 aria-hidden="true" />
              <span className={css.visuallyHidden}>{t('search')}</span>
              <input
                type="search"
                value={query}
                placeholder={t('search')}
                aria-label={t('search')}
                onChange={(event) => { setQuery(event.currentTarget.value) }}
              />
            </label>
            <label className={css.stateFilter}>
              <span className={css.visuallyHidden}>{t('filterState')}</span>
              <select
                value={stateFilter}
                aria-label={t('filterState')}
                onChange={(event) => { setStateFilter(event.currentTarget.value as PluginStateFilter) }}
              >
                {STATE_FILTER_KEYS.map(([value, key]) => (
                  <option key={value} value={value}>{t(key)}</option>
                ))}
              </select>
              <IconChevronDownOutline14 className={css.filterChevron} size={12} aria-hidden="true" />
            </label>
          </div>
          <div className={css.catalogHeading}>
            <h3>{t('catalog')}</h3>
            <span data-plugin-count={filteredEntries.length}>{filteredEntries.length}</span>
          </div>
          {state.snapshot.entries.length === 0 ? <p className={css.status}>{t('empty')}</p> : null}
          {state.snapshot.entries.length > 0 && filteredEntries.length === 0
            ? <p className={css.status}>{t('emptySearch')}</p>
            : null}
          {filteredEntries.length > 0 ? (
            <ul className={css.cards}>
              {filteredEntries.map((entry) => {
                const status = phaseLabel(entry.fiberPhase, t)
                const title = moduleShortName(entry.moduleName)
                const author = entry.author ?? t('authorUnavailable')
                const description = entry.description ?? t('descriptionUnavailable')
                const version = entry.version ?? t('versionUnavailable')
                const configuration = t(entry.enabled ? 'enabledTag' : 'disabledTag')
                const open = expanded === entry.entryId
                const detailId = `${catalogId}-details-${encodeURIComponent(entry.entryId)}`
                return (
                  <li
                    className={css.card}
                    key={entry.entryId}
                    data-plugin-entry={entry.entryId}
                    data-open={open ? 'true' : undefined}
                  >
                    <button
                      className={css.cardContent}
                      type="button"
                      aria-expanded={open}
                      aria-controls={detailId}
                      aria-label={[
                        title,
                        description,
                        `${t('author')}: ${author}`,
                        `${t('version')}: ${version}`,
                        entry.enabled ? status : null,
                        configuration,
                      ].filter((value): value is string => value !== null).join(', ')}
                      onClick={() => {
                        setExpanded(current => current === entry.entryId ? null : entry.entryId)
                      }}
                    >
                      <span className={css.cardSummary}>
                        <strong className={css.cardTitle} title={entry.moduleName}>{title}</strong>
                        <span className={css.cardDescription}>{description}</span>
                        <span className={css.cardMetadata}>
                          <span><span className={css.metadataLabel}>{t('author')}:</span> <span>{author}</span></span>
                          <span><span className={css.metadataLabel}>{t('version')}:</span> <span>{version}</span></span>
                        </span>
                      </span>
                      <span className={css.cardTrailing}>
                        {entry.enabled ? (
                          <span
                            className={css.statusTag}
                            data-phase={entry.fiberPhase ?? 'unobserved'}
                            title={status}
                          >{status}</span>
                        ) : null}
                        <span className={css.configTag} data-enabled={entry.enabled ? 'true' : 'false'}>
                          {configuration}
                        </span>
                        <IconChevronDownOutline14 className={css.chevron} size={12} aria-hidden="true" />
                      </span>
                    </button>
                    {open ? (
                      <div className={css.cardDetails} id={detailId}>
                        <code className={css.entryValue} data-loader-entry>{entry.entryId}</code>
                        <dl className={css.details}>
                          <div>
                            <dt>{t('configuration')}</dt>
                            <dd>{configuration}</dd>
                          </div>
                          {entry.enabled ? (
                            <div>
                              <dt>{t('cordis')}</dt>
                              <dd>{status}</dd>
                            </div>
                          ) : null}
                        </dl>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
