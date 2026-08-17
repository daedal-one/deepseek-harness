/** General-settings editor for the browser product name and logo. */

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { BrandLogo, Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_PRODUCT_NAME, PRODUCT_LOGO_MIME_TYPES, PRODUCT_NAME_MAX_LENGTH,
} from '../branding-settings.ts'
import { encodeProductLogo, ProductLogoFileError } from './logo-file.ts'
import type { BrandingRuntime } from './runtime.ts'
import type { BrandingKey } from './locales.ts'
import css from './BrandingRow.module.css'

/** Settings-row private face. */
export interface BrandingRowInjected {
  hooks: { branding: BrandingRuntime }
  /** Persist a normalized product name. */
  setName: (name: string) => Promise<void>
  /** Clear the user product-name override. */
  resetName: () => Promise<void>
  /** Persist an uploaded raster logo. */
  setLogo: (logo: string) => Promise<void>
  /** Clear the user logo override. */
  resetLogo: () => Promise<void>
}

/** Full branding-row props. */
export type BrandingRowComponentProps = PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.branding'> & InjectFace<BrandingRowInjected>

function errorKey(error: unknown): BrandingKey {
  if (error instanceof ProductLogoFileError) {
    return error.code === 'format' ? 'branding.logo.format' : 'branding.logo.size'
  }
  return 'branding.save.error'
}

/**
 * Render the product-branding editor.
 * @param props - composed settings-row props.
 * @returns name and logo controls with a live preview.
 */
export function BrandingRow({ t, useBranding, setName, resetName, setLogo, resetLogo }: BrandingRowComponentProps) {
  const branding = useBranding(snapshot => snapshot)
  const [draft, setDraft] = useState(branding.name)
  const [error, setError] = useState<BrandingKey | undefined>()
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(branding.name) }, [branding.name])

  const saveName = (event: FormEvent): void => {
    event.preventDefault()
    setError(undefined)
    void setName(draft).catch((cause: unknown) => { setError(errorKey(cause)) })
  }
  const chooseLogo = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    setError(undefined)
    void encodeProductLogo(file)
      .then(setLogo)
      .catch((cause: unknown) => { setError(errorKey(cause)) })
  }

  return (
    <div className={css.group}>
      <div className={css.title}>{t('branding.title')}</div>
      <form className={css.nameForm} onSubmit={saveName}>
        <label className={css.field}>
          <span className={css.label}>{t('branding.name')}</span>
          <Input
            aria-label={t('branding.name')}
            value={draft}
            maxLength={PRODUCT_NAME_MAX_LENGTH}
            placeholder={t('branding.name.placeholder')}
            onChange={(event) => { setDraft(event.target.value) }}
          />
        </label>
        <div className={css.actions}>
          <Button type="submit" variant="primary" size="sm" disabled={draft.trim() === '' || draft.trim() === branding.name}>
            {t('branding.name.save')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={branding.name === DEFAULT_PRODUCT_NAME}
            onClick={() => {
              setError(undefined)
              void resetName().catch((cause: unknown) => { setError(errorKey(cause)) })
            }}
          >
            {t('branding.name.reset')}
          </Button>
        </div>
      </form>
      <div className={css.logoRow}>
        <div className={css.preview} aria-label={t('branding.logo')}>
          <BrandLogo name={branding.name} logo={branding.logo} size={36} />
        </div>
        <div className={css.logoControls}>
          <div className={css.label}>{t('branding.logo')}</div>
          <div className={css.actions}>
            <Button variant="outline" size="sm" onClick={() => { fileInput.current?.click() }}>
              {t('branding.logo.upload')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={branding.logo === undefined}
              onClick={() => {
                setError(undefined)
                void resetLogo().catch((cause: unknown) => { setError(errorKey(cause)) })
              }}
            >
              {t('branding.logo.reset')}
            </Button>
          </div>
          <div className={css.help}>{t('branding.logo.help')}</div>
        </div>
        <input
          ref={fileInput}
          className={css.fileInput}
          type="file"
          accept={PRODUCT_LOGO_MIME_TYPES.join(',')}
          onChange={chooseLogo}
        />
      </div>
      {error !== undefined && <div className={css.error} role="alert">{t(error)}</div>}
    </div>
  )
}
