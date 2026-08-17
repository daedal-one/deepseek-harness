// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { BrandingSettings } from '@deepseek-ai/dsh-client-ui-branding/client'
import { BrandingRuntime, presentBranding } from '@deepseek-ai/dsh-client-ui-branding/client'

const PNG = 'data:image/png;base64,YQ=='

afterEach(() => { document.head.replaceChildren() })

describe('branding favicon presenter', () => {
  it('updates and restores an existing favicon', async () => {
    document.head.innerHTML = '<link rel="icon" href="/old.ico" type="image/x-icon">'
    const branding = new BrandingRuntime(new Context(), stubSettingsScope<BrandingSettings>().scope)
    const dispose = presentBranding(branding)
    const icon = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]')!
    expect(icon.getAttribute('href')).toBe('/favicon.svg')
    expect(icon.type).toBe('image/svg+xml')
    await branding.setLogo(PNG)
    expect(icon.href).toBe(PNG)
    expect(icon.type).toBe('image/png')
    dispose()
    expect(icon.getAttribute('href')).toBe('/old.ico')
    expect(icon.type).toBe('image/x-icon')
  })

  it('owns and removes a favicon when the page had none', () => {
    const branding = new BrandingRuntime(new Context(), stubSettingsScope<BrandingSettings>().scope)
    const dispose = presentBranding(branding)
    expect(document.head.querySelector('link[rel="icon"]')).not.toBeNull()
    dispose()
    expect(document.head.querySelector('link[rel="icon"]')).toBeNull()
  })
})
