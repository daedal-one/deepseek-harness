/** Owner-facing pairing and revocation controls for the current browser Host. */
import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime, PropsLocale, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { DeviceAdministrationService, ConnectionDeviceId } from '@deepseek-ai/dsh-client-connection/client'
import css from './DeviceSettings.module.css'

/** Plain actions and one renderer-bound source supplied by the Connection owner. */
export interface DeviceSettingsInjected {
  openSection: () => void
  closeSection: () => void
  refresh: () => Promise<void>
  enroll: () => Promise<void>
  hide: () => void
  revoke: (deviceId: ConnectionDeviceId) => Promise<void>
  hooks: { administration: DeviceAdministrationService['state'] }
}
/** Section owner values, localized copy and private administration source. */
export type DeviceSettingsProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.devices'> & InjectFace<DeviceSettingsInjected>

/**
 * Render metadata and a transient QR; revocation needs a separate confirmation.
 * @param props - composed Settings section values and actions.
 * @returns the browser device administration section.
 */
export function DeviceSettings({ openSection, closeSection, refresh, enroll, hide, revoke, useAdministration, t }: DeviceSettingsProps) {
  const state = useAdministration(value => value)
  const [confirming, setConfirming] = useState<ConnectionDeviceId | null>(null)
  useEffect(() => { openSection(); return closeSection }, [openSection, closeSection])
  const selected = state.devices.find(device => device.deviceId === confirming)
  const busy = state.busy !== null
  const ready = state.status === 'ready' && !busy
  const local = state.origin !== null && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(state.origin).hostname)
  const qr = state.enrollment === null ? null : JSON.stringify({ version: 1, origin: state.origin, enrollment: state.enrollment })
  return (
    <section className={css.section} aria-label={t('title')}>
      <h2>{t('title')}</h2>
      <p>{t('intro')}</p>
      {state.origin === null ? null : <p className={css.identity}>{state.origin}</p>}
      {state.hostId === null ? null : <p className={css.identity}>{t('hostIdentity')} {state.hostId}</p>}
      {state.status === 'unavailable' ? <p>{t('unavailable')}</p> : state.status === 'disconnected' ? <p>{t('disconnected')}</p> : (
        <>
          {local ? <p role="note">{t('loopback')}</p> : null}
          {state.error === null ? null : <p className={css.error} role="alert">{t(`error.${state.error}`)}</p>}
          <div className={css.actions}>
            <Button variant="primary" disabled={!ready} onClick={() => { setConfirming(null); void enroll() }}>{t('create')}</Button>
            <Button variant="outline" disabled={busy} onClick={() => { setConfirming(null); void refresh() }}>{t('refresh')}</Button>
          </div>
          {state.busy === null ? null : <p role="status">{t(`busy.${state.busy}`)}</p>}
          {qr === null ? null : (
            <div className={css.pairing}>
              <QRCodeSVG value={qr} size={256} marginSize={4} level="M" title={t('qrTitle')} />
              <p>{t('qrHint')}</p>
              <p>{t('hideHint')}</p>
              <Button variant="outline" onClick={hide}>{t('hide')}</Button>
            </div>
          )}
          <h3>{t('devices')}</h3>
          {state.status === 'ready' && state.devices.length === 0 ? <p>{t('empty')}</p> : null}
          <ul className={css.devices}>
            {state.devices.map(device => (
              <li key={device.deviceId} className={css.device}>
                <strong>{device.label}</strong>
                <span className={css.identity}>{device.deviceId}</span>
                <Button variant="outline" size="sm" disabled={!ready} onClick={() => { setConfirming(device.deviceId) }}>{t('revoke')}</Button>
              </li>
            ))}
          </ul>
          {selected === undefined || !ready ? null : (
            <div role="group" aria-label={t('confirmation')} className={css.confirmation}>
              <strong>{t('confirmation')} {selected.label}</strong>
              <p>{t('revokeHint')}</p>
              <div className={css.actions}>
                <Button variant="primary" onClick={() => { setConfirming(null); void revoke(selected.deviceId) }}>{t('confirmRevoke')}</Button>
                <Button variant="outline" onClick={() => { setConfirming(null) }}>{t('cancel')}</Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
