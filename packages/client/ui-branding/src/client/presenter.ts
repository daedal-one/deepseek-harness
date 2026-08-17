/** Browser-chrome projection of the current product logo. */

import { productLogoMimeType } from '../branding-settings.ts'
import { DEFAULT_FAVICON_PATH } from '../boot-branding.ts'
import type { BrandingRuntime, BrandingSnapshot } from './runtime.ts'

interface StoredIcon {
  element: HTMLLinkElement
  created: boolean
  href: string | null
  type: string | null
}

function captureIcon(): StoredIcon {
  const found = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]')
  const element = found ?? document.createElement('link')
  if (found === null) {
    element.rel = 'icon'
    document.head.append(element)
  }
  return {
    element,
    created: found === null,
    href: element.getAttribute('href'),
    type: element.getAttribute('type'),
  }
}

function renderIcon(icon: HTMLLinkElement, snapshot: BrandingSnapshot): void {
  icon.href = snapshot.logo ?? DEFAULT_FAVICON_PATH
  icon.type = snapshot.logo === undefined ? 'image/svg+xml' : productLogoMimeType(snapshot.logo)
}

/**
 * Keep the current logo reflected in the browser tab and restore prior chrome on disposal.
 * @param branding - live branding source.
 * @returns disposer restoring the pre-plugin favicon.
 */
export function presentBranding(branding: BrandingRuntime): () => void {
  const stored = captureIcon()
  const render = (): void => { renderIcon(stored.element, branding.getSnapshot()) }
  render()
  const unsubscribe = branding.subscribe(render)
  return () => {
    unsubscribe()
    if (stored.created) {
      stored.element.remove()
      return
    }
    if (stored.href === null) stored.element.removeAttribute('href')
    else stored.element.setAttribute('href', stored.href)
    if (stored.type === null) stored.element.removeAttribute('type')
    else stored.element.setAttribute('type', stored.type)
  }
}
