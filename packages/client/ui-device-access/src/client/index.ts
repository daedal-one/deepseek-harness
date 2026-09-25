/** Devices settings registration over Connection-owned browser administration. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { DeviceSettings, type DeviceSettingsInjected } from './DeviceSettings.tsx'
import { en, type DeviceSettingsKey } from './locales.ts'

export type { DeviceSettingsProps, DeviceSettingsInjected } from './DeviceSettings.tsx'
export type { DeviceSettingsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Browser-owner pairing and revocation copy. */
    'settings.devices': DeviceSettingsKey
  }
}
const NS = 'settings.devices'
/** Services used by the device section and its localized Settings navigation. */
export const inject = ['connectionDevices', 'slots', 'locale']

/**
 * Register a localized Devices section without issuing requests during plugin activation.
 * @param ctx - Client context carrying Connection's owner-facing service.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { en }), 'ui-device-access: dictionaries')
  const service = ctx.connectionDevices
  const injected: DeviceSettingsInjected = {
    openSection: () => { service.open() }, closeSection: () => { service.close() },
    refresh: () => service.refresh(), enroll: () => service.enroll(),
    hide: () => { service.hideEnrollment() }, revoke: deviceId => service.revoke(deviceId),
    hooks: { administration: service.state },
  }
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'devices', order: 70, label: () => t('title'), locale: NS,
    inject: () => injected,
  }, DeviceSettings))
}
