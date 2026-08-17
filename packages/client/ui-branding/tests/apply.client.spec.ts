// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { BrandingSettings } from '@deepseek-ai/dsh-client-ui-branding/client'
import {
  apply, BRANDING_LOCALE_NAMESPACE, inject, type BrandingRuntime,
} from '@deepseek-ai/dsh-client-ui-branding/client'
import { BrandingRow } from '../src/client/BrandingRow.tsx'

afterEach(() => { document.head.replaceChildren() })

describe('ui-branding browser plugin', () => {
  it('provides the service and its declaration-aware General settings row', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    ctx.provide('connection', {})
    ctx.provide('remote', {})
    const host = stubSettingsScope<BrandingSettings>()
    ctx.provide('settingsScope', { bind: () => host.scope } as never)
    const slots = ctx.get('slots') as SlotRegistry
    slots.register(
      { name: 'root', children: { 'settings.general.item': { kind: 'list', scope: 'root' } } } as never,
      () => null,
    )

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const branding = ctx.get('branding') as BrandingRuntime
    expect(branding.getSnapshot().name).toBe('the harness')
    expect(locale.bind(BRANDING_LOCALE_NAMESPACE)('branding.title')).toBe('Branding')
    locale.setLocale('zh')
    expect(locale.bind(BRANDING_LOCALE_NAMESPACE)('branding.title')).toBe('品牌')
    const entry = slots.entries('settings.general.item').find(candidate => candidate.component === BrandingRow)!
    expect(entry.options).toMatchObject({ id: 'branding', order: -20 })
    expect(entry.locale).toBe(BRANDING_LOCALE_NAMESPACE)
    expect(document.head.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe('/favicon.svg')

    const face = (entry.inject as () => {
      hooks: { branding: BrandingRuntime }
      setName: (name: string) => Promise<void>
    })()
    expect(face.hooks.branding).toBe(branding)
    await face.setName('Studio')
    expect(host.set).toHaveBeenCalledWith('name', 'Studio')

    await fiber.dispose()
    expect(ctx.get('branding')).toBeUndefined()
    expect(slots.entries('settings.general.item')).toHaveLength(0)
    expect(document.head.querySelector('link[rel="icon"]')).toBeNull()
  })

  it('waits for a later General-slot declaration', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    ctx.provide('connection', {})
    ctx.provide('remote', {})
    ctx.provide('settingsScope', { bind: () => stubSettingsScope<BrandingSettings>().scope } as never)
    const slots = ctx.get('slots') as SlotRegistry
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(slots.entries('settings.general.item')).toHaveLength(0)
    slots.register(
      { name: 'root', children: { 'settings.general.item': { kind: 'list', scope: 'root' } } } as never,
      () => null,
    )
    await Promise.resolve()
    expect(slots.entries('settings.general.item').some(entry => entry.component === BrandingRow)).toBe(true)
  })
})
