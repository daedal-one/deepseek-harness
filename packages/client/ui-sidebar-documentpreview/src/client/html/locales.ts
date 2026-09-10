/** HTML renderer dictionary keys. */
export type HtmlPreviewKey = keyof typeof en

/** English copy for this feature. */
export const en = {
  title: 'HTML',
  frame: 'HTML document preview',
  loading: 'Preparing HTML preview…',
  failed: 'This HTML document could not be previewed.',
} satisfies Record<string, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** HTML preview selection and status text. */
    documentHtml: HtmlPreviewKey
  }
}
