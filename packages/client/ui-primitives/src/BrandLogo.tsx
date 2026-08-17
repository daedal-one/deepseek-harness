/** Product logo primitive with the built-in fish as its fallback. */

import { FishLogo } from './FishLogo.tsx'

/** Props for one decorative product logo. */
export interface BrandLogoProps {
  /** Product name used to describe an uploaded image. */
  name: string
  /** Uploaded raster data URL; absence renders the built-in fish. */
  logo?: string | undefined
  /** Maximum rendered width and height in pixels. */
  size?: number
  /** Extra class for layout placement. */
  className?: string | undefined
}

/**
 * Render the current product logo without coupling primitives to settings.
 * @param props - product identity and requested display size.
 * @returns an uploaded raster image or the built-in fish mark.
 */
export function BrandLogo({ name, logo, size = 24, className }: BrandLogoProps) {
  if (logo === undefined) return <FishLogo size={size} className={className} />
  return (
    <img
      src={logo}
      alt={`${name} logo`}
      width={size}
      height={size}
      className={className}
      style={{ objectFit: 'contain' }}
    />
  )
}
