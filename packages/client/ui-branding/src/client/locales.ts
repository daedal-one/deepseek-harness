/** `settings.branding` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'branding.title': '品牌',
  'branding.name': '产品名称',
  'branding.name.placeholder': '输入产品名称',
  'branding.name.save': '保存名称',
  'branding.name.reset': '使用默认名称',
  'branding.logo': '产品标志',
  'branding.logo.upload': '上传标志',
  'branding.logo.reset': '使用默认标志',
  'branding.logo.help': '支持 PNG、JPEG、WebP、GIF 或 AVIF，最大 512 KiB。',
  'branding.logo.format': '请选择 PNG、JPEG、WebP、GIF 或 AVIF 图像。',
  'branding.logo.size': '图像大小不能超过 512 KiB。',
  'branding.save.error': '无法保存品牌设置。',
} satisfies Record<string, string>

/** Branding settings copy key union. */
export type BrandingKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'branding.title': 'Branding',
  'branding.name': 'Product name',
  'branding.name.placeholder': 'Enter a product name',
  'branding.name.save': 'Save name',
  'branding.name.reset': 'Use default name',
  'branding.logo': 'Product logo',
  'branding.logo.upload': 'Upload logo',
  'branding.logo.reset': 'Use default logo',
  'branding.logo.help': 'PNG, JPEG, WebP, GIF, or AVIF up to 512 KiB.',
  'branding.logo.format': 'Choose a PNG, JPEG, WebP, GIF, or AVIF image.',
  'branding.logo.size': 'The image must be 512 KiB or smaller.',
  'branding.save.error': 'The branding setting could not be saved.',
} satisfies Record<BrandingKey, string>
