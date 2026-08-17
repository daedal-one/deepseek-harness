// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import {
  BrandingRuntime, type BrandingSettings,
} from '@deepseek-ai/dsh-client-ui-branding/client'

const PNG = 'data:image/png;base64,YQ=='

function make() {
  const ctx = new Context()
  const host = stubSettingsScope<BrandingSettings>()
  const branding = new BrandingRuntime(ctx, host.scope)
  return { ctx, host, branding }
}

describe('BrandingRuntime', () => {
  it('starts with the product default and publishes optimistic durable writes', async () => {
    const { branding, host } = make()
    const listener = vi.fn()
    const unsubscribe = branding.subscribe(listener)
    expect(branding.getSnapshot()).toEqual({ name: 'the harness', revision: 0 })

    await branding.setName('  Studio  ')
    expect(branding.getSnapshot()).toEqual({ name: 'Studio', revision: 1 })
    expect(host.set).toHaveBeenCalledWith('name', 'Studio')
    await branding.setName('Studio')
    expect(listener).toHaveBeenCalledOnce()

    await branding.setLogo(PNG)
    expect(branding.getSnapshot()).toMatchObject({ name: 'Studio', logo: PNG, revision: 2 })
    expect(host.set).toHaveBeenLastCalledWith('logo', PNG)
    await branding.setLogo(PNG)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    await branding.resetLogo()
    expect(listener).toHaveBeenCalledTimes(2)
    expect(branding.getSnapshot()).toEqual({ name: 'Studio', revision: 3 })
    expect(host.unset).toHaveBeenCalledWith('logo')
  })

  it('resets name and logo to their inherited defaults', async () => {
    const { branding, host } = make()
    await branding.setName('Studio')
    await branding.setLogo(PNG)
    await branding.resetName()
    expect(branding.getSnapshot()).toMatchObject({ name: 'the harness', logo: PNG })
    expect(host.unset).toHaveBeenCalledWith('name')
    await branding.resetName()
    expect(host.unset).toHaveBeenCalledTimes(2)
    await branding.resetLogo()
    await branding.resetLogo()
    expect(host.unset).toHaveBeenCalledTimes(4)
  })

  it('adopts accepted Host values without writing them back', () => {
    const host = stubSettingsScope<BrandingSettings>()
    host.publish({ status: 'ready', value: { name: 'Loaded', logo: PNG }, revision: 1, writable: true })
    const ctx = new Context()
    const branding = new BrandingRuntime(ctx, host.scope)
    expect(branding.getSnapshot()).toEqual({ name: 'Loaded', logo: PNG, revision: 1 })
    expect(host.set).not.toHaveBeenCalled()

    host.publish({ value: { name: 'Loaded', logo: PNG }, revision: 2 })
    expect(branding.getSnapshot().revision).toBe(1)
    host.publish({ value: { name: 'Host name' }, revision: 3 })
    expect(branding.getSnapshot()).toEqual({ name: 'Host name', revision: 2 })
  })

  it('rejects invalid optimistic values before writing', () => {
    const { branding, host } = make()
    expect(() => branding.setName('   ')).toThrow(/1-48/)
    expect(() => branding.setName('x'.repeat(49))).toThrow(/1-48/)
    expect(() => branding.setLogo('data:image/svg+xml;base64,YQ==')).toThrow(/supported raster/)
    expect(host.set).not.toHaveBeenCalled()
  })

  it('releases the Host subscription with its context', async () => {
    const { ctx, host } = make()
    expect(host.listenerCount()).toBe(1)
    await ctx.fiber.dispose()
    expect(host.listenerCount()).toBe(0)
  })
})
