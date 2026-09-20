/** User-opened fork overview; dismissal restores focus to the brand control. */
import { useEffect, useRef } from 'react'
import { DaedalMark, Modal, LinkIcon } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarRootComponentProps } from './contract/slots.ts'
import css from './ForkOverview.module.css'

/**
 * Explain implemented fork features in a keyboard-accessible dialog.
 * @param props - Localized copy and the owner's close action.
 * @returns The overview, mounted only after explicit activation.
 */
export function ForkOverview({ t, onClose }: {
  t: SidebarRootComponentProps['t']
  onClose: () => void
}) {
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previousFocus = document.activeElement
    const appRoot = document.getElementById('root')
    const previousInert = appRoot?.inert ?? false
    if (appRoot) appRoot.inert = true
    const dialog = content.current?.closest<HTMLElement>('[role="dialog"]')
    dialog?.querySelector<HTMLElement>('button')?.focus()
    const trapFocus = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || !dialog) return
      const controls = [...dialog.querySelectorAll<HTMLElement>('button, a[href]')]
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', trapFocus)
    return () => {
      document.removeEventListener('keydown', trapFocus)
      if (appRoot) appRoot.inert = previousInert
      if (previousFocus instanceof HTMLElement) previousFocus.focus()
    }
  }, [])

  return (
    <Modal open title={t('fork.open')} closeLabel={t('fork.close')} onClose={onClose}
      className={css.dialog as string} contentClassName={css.content as string}>
      <div ref={content} className={css.overview}>
        <div className={css.identity}><DaedalMark size={48} /><span>{t('fork.eyebrow')}</span></div>
        <h3 className={css.headline}>{t('fork.title')}</h3>
        <p className={css.intro}>{t('fork.intro')}</p>
        <h4 className={css.sectionTitle}>{t('fork.changes')}</h4>
        <dl className={css.features}>
          {(['models', 'policy', 'workspace', 'language'] as const).map(feature => (
            <div key={feature} className={css.feature}>
              <dt>{t(`fork.${feature}.title`)}</dt>
              <dd>{t(`fork.${feature}.body`)}</dd>
            </div>
          ))}
        </dl>
        <div className={css.links}>
          <a href="https://github.com/daedal-one/deepseek-harness#changes-in-this-fork" target="_blank" rel="noreferrer">
            <LinkIcon kind="url" />{t('fork.source')}
          </a>
          <a href="https://github.com/deepseek-ai/deepseek-harness" target="_blank" rel="noreferrer">
            <LinkIcon kind="url" />{t('fork.upstream')}
          </a>
        </div>
      </div>
    </Modal>
  )
}
