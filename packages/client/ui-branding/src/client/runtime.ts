/** Browser-side owner of the current product name and uploaded logo. */

import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import {
  DEFAULT_PRODUCT_NAME, isProductLogoDataUrl, PRODUCT_LOGO_FIELD,
  PRODUCT_NAME_FIELD, normalizeProductName, type BrandingSettings,
} from '../branding-settings.ts'

/** Immutable branding state published to browser surfaces. */
export interface BrandingSnapshot {
  /** Product name shown in application and browser chrome. */
  name: string
  /** Uploaded raster logo data URL; absence uses the built-in fish mark. */
  logo?: string
  /** Monotonic change counter. */
  revision: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Live user-controlled product identity. */
    branding: BrandingRuntime
  }
}

/** Durable branding preference owner and observable source. */
export class BrandingRuntime implements HostObservable<BrandingSnapshot> {
  private snapshot: BrandingSnapshot = Object.freeze({ name: DEFAULT_PRODUCT_NAME, revision: 0 })
  private readonly listeners = new Set<() => void>()

  /**
   * @param ctx - owning plugin context; releases the settings subscription.
   * @param host - durable settings scope owned by this feature.
   */
  constructor(ctx: Context, private readonly host: SettingsScope<BrandingSettings>) {
    ctx.effect(() => host.subscribe(() => { this.adopt() }), 'ui-branding: settings scope adoption')
    this.adopt()
  }

  /** @returns the current immutable branding snapshot. */
  getSnapshot = (): BrandingSnapshot => this.snapshot

  /**
   * Observe snapshot replacements.
   * @param listener - invoked after a branding change.
   * @returns disposer removing the listener.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Persist a new product name after trimming and validation.
   * @param value - editor value supplied by the user.
   * @returns settlement of the durable write.
   */
  setName(value: string): Promise<void> {
    const name = normalizeProductName(value)
    if (name === this.snapshot.name) return Promise.resolve()
    this.publish(settings(name, this.snapshot.logo))
    return this.host.set(PRODUCT_NAME_FIELD, name)
  }

  /**
   * Clear the user product-name override.
   * @returns settlement of the durable removal.
   */
  resetName(): Promise<void> {
    if (this.snapshot.name !== DEFAULT_PRODUCT_NAME) {
      this.publish(settings(DEFAULT_PRODUCT_NAME, this.snapshot.logo))
    }
    return this.host.unset(PRODUCT_NAME_FIELD)
  }

  /**
   * Persist one accepted raster logo data URL.
   * @param logo - bounded PNG, JPEG, WebP, GIF, or AVIF data URL.
   * @returns settlement of the durable write.
   */
  setLogo(logo: string): Promise<void> {
    if (!isProductLogoDataUrl(logo)) throw new TypeError('product logo must be a supported raster image under 512 KiB')
    if (logo === this.snapshot.logo) return Promise.resolve()
    this.publish({ name: this.snapshot.name, logo })
    return this.host.set(PRODUCT_LOGO_FIELD, logo)
  }

  /**
   * Clear the uploaded logo override.
   * @returns settlement of the durable removal.
   */
  resetLogo(): Promise<void> {
    if (this.snapshot.logo !== undefined) this.publish({ name: this.snapshot.name })
    return this.host.unset(PRODUCT_LOGO_FIELD)
  }

  private adopt(): void {
    const section = this.host.getSnapshot().value
    const name = section?.name ?? DEFAULT_PRODUCT_NAME
    const logo = section?.logo
    if (name === this.snapshot.name && logo === this.snapshot.logo) return
    this.publish(settings(name, logo))
  }

  private publish(value: BrandingSettings): void {
    this.snapshot = Object.freeze({ ...value, revision: this.snapshot.revision + 1 })
    for (const listener of this.listeners) listener()
  }
}

function settings(name: string, logo: string | undefined): BrandingSettings {
  return logo === undefined ? { name } : { name, logo }
}
