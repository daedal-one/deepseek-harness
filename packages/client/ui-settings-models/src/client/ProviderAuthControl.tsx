/** Provider account controls over callbacks owned by the Models plugin. */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ProviderAccount, ProviderAccountUpdate } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelsOperations } from './operations.ts'
import type { ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'

interface Props {
  provider: string
  operations: Pick<ModelsOperations, 'listAccounts' | 'signIn' | 'answerAccount' | 'signOut'>
  t: (key: ModelsKey) => string
  disabled: boolean
  onAccountOnly: (only: boolean) => void
}

/**
 * Render registered account methods and the current sign-in question.
 * @param props - provider identity, host callbacks, and localized copy.
 * @returns account controls; providers without account methods render nothing.
 */
export function ProviderAuthControl({ provider, operations, t, disabled, onAccountOnly }: Props): ReactNode {
  const [account, setAccount] = useState<ProviderAccount>()
  const [progress, setProgress] = useState<ProviderAccountUpdate>()
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<ModelsKey>()
  const [revision, setRevision] = useState(0)
  const lifetime = useRef<AbortController>()

  useEffect(() => {
    let stale = false
    const controller = new AbortController()
    lifetime.current = controller
    void operations.listAccounts().then((accounts) => {
      if (stale) return
      const next = accounts.find(candidate => candidate.key === `llm-pi-ai/${provider}`
        && candidate.methods.some(method => method.id === 'oauth'))
      setAccount(next)
      onAccountOnly(next !== undefined && next.methods.every(method => method.id === 'oauth'))
    }, () => { if (!stale) setFailure('accountLoadFailed') })
    return () => { stale = true; controller.abort() }
  }, [provider, operations, onAccountOnly, revision])

  const signIn = async (method: string): Promise<void> => {
    if (account === undefined) return
    const signal = lifetime.current?.signal
    if (signal === undefined) return
    setBusy(true)
    setFailure(undefined)
    setProgress(undefined)
    try {
      await operations.signIn(account.key, method, signal, (next) => {
        if (signal.aborted) return
        setProgress(next)
        setAnswer('')
        if (next.status === 'failed') setFailure('accountFailed')
      })
    } catch {
      // The host or carrier refused this sign-in; provider payloads may contain secrets.
      if (!signal.aborted) setFailure('accountFailed')
    } finally {
      if (!signal.aborted) { setBusy(false); setRevision(value => value + 1) }
    }
  }
  const signOut = async (): Promise<void> => {
    if (account === undefined) return
    setBusy(true)
    setFailure(undefined)
    try { await operations.signOut(account.key); setProgress(undefined); setRevision(value => value + 1) } catch {
      // A failed sign-out preserves the displayed account until it can be re-read.
      setFailure('accountSignOutFailed')
    } finally { setBusy(false) }
  }
  const submit = async (value: string): Promise<void> => {
    if (progress?.prompt === undefined) return
    try { await operations.answerAccount(progress.id, progress.prompt.id, value); setAnswer('') } catch {
      // A withdrawn question or disconnected carrier requires another sign-in attempt.
      setFailure('accountFailed')
    }
  }
  const cancel = (): void => {
    lifetime.current?.abort()
    setBusy(false)
    setProgress(undefined)
    setFailure('accountCancelled')
    setRevision(value => value + 1)
  }
  const prompt = progress?.status === 'pending' ? progress.prompt : undefined
  if (account === undefined && failure === undefined) return null
  return <div className={styles['field']}>
    <span className={styles['fieldLabel']}>{t('account')}</span>
    {account === undefined ? null : <p role="status">{t(busy ? 'accountBusy' : account.configured ? 'accountSignedIn' : 'accountSignedOut')}</p>}
    {failure === undefined ? null : <p role="alert" className={styles['error']}>{t(failure)}</p>}
    {account === undefined ? <button className={styles['secondaryButton']} type="button" onClick={() => { setRevision(value => value + 1) }}>{t('retry')}</button> : null}
    {busy ? <>
      {progress?.status === 'pending' && progress.message !== undefined ? <p>{progress.message}</p> : null}
      {progress?.status === 'pending' && progress.url !== undefined ? <a href={progress.url} target="_blank" rel="noreferrer">{t('accountContinue')}</a> : null}
      {progress?.status === 'pending' && progress.code !== undefined ? <code>{progress.code}</code> : null}
      {prompt === undefined ? null : <div>
        <p>{prompt.message}</p>
        {prompt.kind === 'select' ? prompt.options?.map(option => <button className={styles['secondaryButton']} type="button" key={option.id}
          onClick={() => { void submit(option.id) }}>{option.label}</button>) : <>
          <input className={styles['input']} type={prompt.kind === 'secret' ? 'password' : 'text'}
            autoComplete="off" aria-label={prompt.message} placeholder={prompt.placeholder} value={answer}
            onChange={(event) => { setAnswer(event.target.value) }} />
          <button className={styles['secondaryButton']} type="button" disabled={answer.length === 0} onClick={() => { void submit(answer) }}>{t('accountSubmit')}</button>
        </>}
      </div>}
      <button className={styles['secondaryButton']} type="button" onClick={cancel}>{t('cancel')}</button>
    </> : <>
      {account?.methods.filter(method => method.id === 'oauth').map(method => <button className={styles['secondaryButton']} type="button" key={method.id} disabled={disabled || account.inFlight}
        onClick={() => { void signIn(method.id) }}>{method.label}</button>)}
      {account?.configured === true ? <button className={styles['secondaryButton']} type="button" disabled={disabled} onClick={() => { void signOut() }}>{t('accountSignOut')}</button> : null}
    </>}
  </div>
}
