import { describe, expect, it } from 'vitest'
import {
  brandingManifest, decodeProductLogo, injectBootBranding,
} from '@deepseek-ai/dsh-client-ui-branding'
import {
  isProductLogoDataUrl, normalizeProductName, productLogoMimeType,
} from '../src/branding-settings.ts'

const PNG = 'data:image/png;base64,YQ=='

describe('branding values', () => {
  it('normalizes names and rejects empty or overlong values', () => {
    expect(normalizeProductName('  Studio  ')).toBe('Studio')
    expect(() => normalizeProductName('\t')).toThrow(/1-48/)
    expect(() => normalizeProductName('x'.repeat(49))).toThrow(/1-48/)
  })

  it('accepts the supported bounded raster data URL family', () => {
    for (const type of ['png', 'jpeg', 'webp', 'gif', 'avif']) {
      const value = `data:image/${type};base64,YQ==`
      expect(isProductLogoDataUrl(value)).toBe(true)
      expect(productLogoMimeType(value)).toBe(`image/${type}`)
    }
    expect(isProductLogoDataUrl('data:image/svg+xml;base64,YQ==')).toBe(false)
    expect(isProductLogoDataUrl(`data:image/png;base64,${'A'.repeat(700_000)}`)).toBe(false)
    expect(() => productLogoMimeType('data:image/svg+xml;base64,YQ==')).toThrow(/unsupported/)
  })

  it('injects escaped boot title and the dynamic icon route', () => {
    const html = injectBootBranding(
      '<html><head><link rel="icon" href="/old.svg"><title>Old</title></head><body></body></html>',
      { name: 'A < B & C', logo: PNG },
    )
    expect(html).toContain('<title>A &lt; B &amp; C</title>')
    expect(html).toContain('<link rel="icon" href="/branding/logo" />')
    expect(html).not.toContain('/old.svg')
  })

  it('adds missing title and icon elements before the head closes', () => {
    const html = injectBootBranding('<html><head></head><body></body></html>')
    expect(html).toContain('<title>the harness</title>')
    expect(html).toContain('<link rel="icon" href="/branding/logo" />')
  })

  it('builds default and uploaded-logo install metadata', () => {
    expect(brandingManifest()).toMatchObject({
      name: 'the harness', short_name: 'the harness',
      icons: [{ src: '/favicon.svg', type: 'image/svg+xml' }],
    })
    expect(brandingManifest({ name: 'Studio', logo: PNG })).toMatchObject({
      name: 'Studio', short_name: 'Studio',
      icons: [{ src: '/branding/logo', type: 'image/png' }],
    })
  })

  it('decodes the uploaded logo for the Host route', () => {
    const decoded = decodeProductLogo(PNG)
    expect(decoded.type).toBe('image/png')
    expect(decoded.body.toString('utf8')).toBe('a')
  })
})
