/** Browser branding service, presenter, and settings surface. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { BrandingRow, type BrandingRowInjected } from './BrandingRow.tsx'
import { en, zh, type BrandingKey } from './locales.ts'
import { presentBranding } from './presenter.ts'
import { BrandingRuntime } from './runtime.ts'
import { BRANDING_SETTINGS_NAMESPACE, type BrandingSettings } from '../branding-settings.ts'

export { BrandingRuntime, type BrandingSnapshot } from './runtime.ts'
export { encodeProductLogo, ProductLogoFileError } from './logo-file.ts'
export { presentBranding } from './presenter.ts'
export type { BrandingRowComponentProps, BrandingRowInjected } from './BrandingRow.tsx'
export type { BrandingSettings } from '../branding-settings.ts'

/** Dictionary namespace owned by the branding settings row. */
export const BRANDING_LOCALE_NAMESPACE = 'settings.branding'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Product-branding settings copy. */
    'settings.branding': BrandingKey
  }
}

/** Services required by the browser branding plugin. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

/**
 * Provide live branding, project the favicon, and register the General settings row.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const host = ctx.settingsScope.bind<BrandingSettings>({ namespace: BRANDING_SETTINGS_NAMESPACE })
  const branding = new BrandingRuntime(ctx, host)
  ctx.provide('branding', branding)
  ctx.effect(() => presentBranding(branding), 'ui-branding: favicon projection')
  ctx.effect(
    () => ctx.locale.register(BRANDING_LOCALE_NAMESPACE, { zh, en }),
    'ui-branding: settings row dictionaries',
  )
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'branding',
    order: -20,
    locale: BRANDING_LOCALE_NAMESPACE,
    inject: (): BrandingRowInjected => ({
      hooks: { branding },
      setName: value => branding.setName(value),
      resetName: () => branding.resetName(),
      setLogo: logo => branding.setLogo(logo),
      resetLogo: () => branding.resetLogo(),
    }),
  }, BrandingRow))
}
