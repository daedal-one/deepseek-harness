/** The settings.locale namespace key union. */
export type SettingsLocaleKey = keyof typeof en

/** English copy for this feature. */
export const en = {
  'language.title': 'Language',
} satisfies Record<string, string>
