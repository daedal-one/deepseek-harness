import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { PermissionSelect as PermissionSelectValue } from '@deepseek-ai/dsh-permission-presets/client'
import { IconChevronDownOutline14, Menu, RiskConfirmation, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComposerBarProps } from '../contract/slots.ts'
import { en } from '../locales.ts'
import css from './PermissionSelect.module.css'

const FULL_ACCESS = 'danger-full-access'

/** Compact policy glyphs are independent of execution placement. */
function permissionGlyph(value: string): ReactNode {
  const paths: Record<string, ReactNode> = {
    'read-only': <><path d="M1 8s2.5-4 7-4 7 4 7 4-2.5 4-7 4-7-4-7-4Z" /><circle cx="8" cy="8" r="1.8" /></>,
    'workspace-write': <path d="M2 13V3h4l2 2h6v8H2Zm7-4h3m-1.5-1.5v3" />,
    'policy-reviewed': <><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5M5 7l1.5 1.5L9 6" /></>,
    'danger-full-access': <><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M6 7V4a3 3 0 0 1 5.5-1.5M8 10v1" /></>,
  }
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{Object.hasOwn(paths, value) ? paths[value] : <circle cx="8" cy="8" r="5" />}</svg>
}

function environmentGlyph(environment: string): ReactNode {
  const shape = environment === 'container'
    ? <><path d="m8 1 6 3.5v7L8 15l-6-3.5v-7L8 1Zm-6 3.5L8 8l6-3.5M8 8v7M5 2.8l6 3.5" /></>
    : environment === 'host'
      ? <><rect x="1.5" y="2" width="13" height="9" rx="1.5" /><path d="M5 14h6M8 11v3" /></>
      : environment === 'external'
        ? <><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c4 4 4 8 0 12-4-4-4-8 0-12Z" /></>
        : <><circle cx="8" cy="8" r="6" /><path d="M6.5 6a1.5 1.5 0 1 1 2.4 1.2C8 7.8 8 8 8 9m0 2h.01" /></>
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{shape}</svg>
}

/**
 * Display transform: built-in machine names render as locale product labels;
 * non-kebab host-configured names pass through.
 */
function displayName(name: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name
  return name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

const BUILT_IN_PERMISSION_NAMES = new Map<string, string>([
  ['read-only', en['access.preset.readOnly']],
  ['workspace-write', en['access.preset.workspaceWrite']],
  [FULL_ACCESS, en['access.preset.fullAccess']],
])

function permissionDescription(
  value: string,
  description: string | undefined,
  t: ComposerBarProps['t'],
): string | undefined {
  if (description !== undefined) return description
  if (value === 'read-only') return t('access.preset.readOnly.description')
  if (value === 'workspace-write') return t('access.preset.workspaceWrite.description')
  if (value === FULL_ACCESS) return t('access.preset.fullAccess.description')
  return undefined
}

function permissionLabel(
  value: string,
  name: string,
  t: ComposerBarProps['t'],
): string {
  const builtInName = BUILT_IN_PERMISSION_NAMES.get(value)
  if (builtInName !== undefined && (name === value || name === builtInName)) {
    if (value === 'read-only') return t('access.preset.readOnly')
    if (value === 'workspace-write') return t('access.preset.workspaceWrite')
    if (value === FULL_ACCESS) return t('access.preset.fullAccess')
  }
  return displayName(name)
}

export interface PermissionSelectProps {
  value: PermissionSelectValue | undefined
  locked: boolean
  command: (line: string) => Promise<boolean>
  /** The owning bar's locale seat, passed down as a plain prop. */
  t: ComposerBarProps['t']
}

export function PermissionSelect({ value, locked, command, t }: PermissionSelectProps) {
  const [pick, setPick] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)

  useEffect(() => {
    if (!locked && value !== undefined) return
    setOpen(false)
    setAcknowledged(false)
    setConfirmation(null)
  }, [locked, value])

  if (value === undefined) return null

  const currentValue = pick ?? value.currentValue
  const current = value.options.find(option => option.value === currentValue)
  const currentLabel = current === undefined
    ? permissionLabel(currentValue, currentValue, t)
    : permissionLabel(current.value, current.name, t)
  const currentDescription = permissionDescription(currentValue, current?.description, t)
  const busy = pick !== null || confirmation !== null
  const canChange = value.canChange !== false
  const environment = value.context?.environment ?? 'unknown'
  const environmentLabel = t(`access.environment.${environment}`)
  const accessLabel = `${environmentLabel} · ${currentLabel}`

  const choices: MenuEntry[] = value.options
    .filter(o => o.value !== 'custom')
    .map((option) => {
      const tooltip = permissionDescription(option.value, option.description, t)
      return {
        id: option.value,
        label: permissionLabel(option.value, option.name, t),
        icon: permissionGlyph(option.value),
        disabled: !canChange,
        ...tooltip === undefined ? {} : { tooltip },
      }
    })

  const items: MenuEntry[] = [
    { type: 'label', id: 'environment', text: t(`access.environmentDetail.${environment}`) },
    ...choices,
    { type: 'separator', id: 'access-detail' },
    { type: 'label', id: 'access-source', text: canChange
      ? t(value.context?.defaultPreset === currentValue ? 'access.profileDefault' : 'access.sessionOverride')
      : t('access.fixed') },
  ]

  const submit = (id: string): void => {
    if (!canChange) return
    setPick(id)
    void command(`/permission ${id}`)
      .catch(() => false)
      .then(() => { setPick(null) })
  }

  const choose = (id: string): void => {
    setOpen(false)
    if (!canChange || id === value.currentValue) return
    if (id === FULL_ACCESS) {
      setAcknowledged(false)
      setConfirmation(id)
      return
    }
    submit(id)
  }

  const closeConfirmation = (): void => {
    setAcknowledged(false)
    setConfirmation(null)
  }

  const confirmFullAccess = (): void => {
    if (locked || !canChange || !acknowledged || confirmation === null) return
    const id = confirmation
    closeConfirmation()
    submit(id)
  }

  return (
    <>
      <Menu
        open={open}
        items={items}
        selectedId={currentValue}
        onSelect={choose}
        onClose={() => { setOpen(false) }}
        side="top"
        anchor={
          <Tooltip
            label={currentDescription ?? ''}
            side="top"
            delayMs={400}
            disabled={open || currentDescription === undefined}
            maxWidth={320}
          >
            <button
              type="button"
              className={css.trigger}
              aria-label={t('input.accessMode', { name: accessLabel })}
              disabled={locked || busy}
              onClick={() => { setOpen(!open) }}
            >
              <span className={css.triggerIcon} aria-hidden>{environmentGlyph(environment)}</span>
              <span className={css.triggerLabel}>{currentLabel}</span>
              <span className={clsx(css.chevron, open && css.chevronOpen)} aria-hidden>
                <IconChevronDownOutline14 />
              </span>
            </button>
          </Tooltip>
        }
      />
      <RiskConfirmation
        open={confirmation !== null}
        title={t('access.confirm.title')}
        description={t('access.confirm.description')}
        acknowledgeLabel={t('access.confirm.acknowledge')}
        cancelLabel={t('access.confirm.cancel')}
        closeLabel={t('close')}
        confirmLabel={t('access.confirm.enable')}
        acknowledged={acknowledged}
        disabled={locked}
        onAcknowledgedChange={setAcknowledged}
        onCancel={closeConfirmation}
        onConfirm={confirmFullAccess}
      />
    </>
  )
}
