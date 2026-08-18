/** Account authentication control for one provider row or add card. */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  IApiClient, ProviderAuthMethodView, ProviderAuthOperationView,
} from '@deepseek-ai/dsh-api-remotes/client'
import { messageOf } from './store.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Props of {@link ProviderAuthControl}. */
export interface ProviderAuthControlProps {
  provider: string
  method: ProviderAuthMethodView | undefined
  api: Pick<IApiClient, 'llm'>
  t: (key: keyof typeof en) => string
  readOnly: boolean
  onChanged: () => void
}

/** Provider OAuth control with device-code polling, cancellation, and logout. */
export function ProviderAuthControl(props: ProviderAuthControlProps): ReactNode {
  const { provider, method, api, t, onChanged } = props
  const [operation, setOperation] = useState<ProviderAuthOperationView | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (operation?.status !== 'pending') return () => undefined
    let stale = false
    const delay = operation.authorization?.intervalSeconds === undefined
      ? 500
      : Math.max(1_000, operation.authorization.intervalSeconds * 1_000)
    const timer = setTimeout(() => {
      void api.llm.providerAuthStatus({ operationId: operation.id }).then(
        (response) => {
          if (stale) return
          if (!response.result.ok) {
            setFailure(response.result.error.message)
            return
          }
          setOperation(response.result.value.operation)
          if (response.result.value.operation.status === 'succeeded') onChanged()
        },
        (error: unknown) => { if (!stale) setFailure(messageOf(error)) },
      )
    }, delay)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [api.llm, onChanged, operation])

  if (method === undefined || method.type !== 'oauth' || method.authenticated === undefined) return null

  const start = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const response = await api.llm.startProviderAuth({ provider, method: 'oauth' })
      if (!response.result.ok) {
        setFailure(response.result.error.message)
        return
      }
      setOperation(response.result.value.operation)
    } catch (error) {
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (): Promise<void> => {
    if (operation === undefined) return
    setBusy(true)
    setFailure(undefined)
    try {
      const response = await api.llm.cancelProviderAuth({ operationId: operation.id })
      if (!response.result.ok) {
        setFailure(response.result.error.message)
        return
      }
      setOperation(response.result.value.operation)
    } catch (error) {
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const logout = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const response = await api.llm.logoutProviderAuth({ provider, method: 'oauth' })
      if (!response.result.ok) {
        setFailure(response.result.error.message)
        return
      }
      setOperation(undefined)
      onChanged()
    } catch (error) {
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const authenticated = method.authenticated || operation?.status === 'succeeded'
  return (
    <div className={styles['authBlock']}>
      <div className={styles['authCopy']}>
        <span className={styles['fieldLabel']}>{method.name}</span>
        {authenticated ? <span className={styles['authHint']}>{t('accountConnected')}</span> : null}
        {operation?.status === 'pending' && operation.authorization === undefined
          ? <span className={styles['authHint']}>{t('accountPreparing')}</span>
          : null}
        {operation?.status === 'pending' && operation.authorization !== undefined
          ? (
            <span className={styles['deviceFlow']}>
              <span>{t('accountDeviceInstructions')}</span>
              <code className={styles['deviceCode']}>{operation.authorization.userCode}</code>
              <a
                className={styles['authLink']}
                href={operation.authorization.verificationUri}
                target="_blank"
                rel="noreferrer"
              >
                {t('accountOpenVerification')}
              </a>
            </span>
          )
          : null}
        {operation?.status === 'cancelled' ? <span className={styles['authHint']}>{t('accountCancelled')}</span> : null}
        {operation?.status === 'failed' ? <span className={styles['error']}>{operation.error}</span> : null}
        {failure === undefined ? null : <span className={styles['error']}>{failure}</span>}
      </div>
      <span className={styles['authActions']}>
        {authenticated
          ? (
            <button
              type="button"
              className={styles['secondaryButton']}
              disabled={busy || props.readOnly}
              onClick={() => { void logout() }}
            >
              {busy ? t('accountSigningOut') : t('accountSignOut')}
            </button>
          )
          : operation?.status === 'pending'
            ? (
              <button
                type="button"
                className={styles['secondaryButton']}
                disabled={busy}
                onClick={() => { void cancel() }}
              >
                {busy ? t('accountCancelling') : t('accountCancel')}
              </button>
            )
            : (
              <button
                type="button"
                className={styles['primaryButton']}
                disabled={busy || props.readOnly}
                onClick={() => { void start() }}
              >
                {busy ? t('accountStarting') : t('accountSignIn')}
              </button>
            )}
      </span>
    </div>
  )
}
