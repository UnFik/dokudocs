import { describe, expect, it } from 'vitest'
import { pickIcon, type IconManifest } from './catalog-icon'

const manifest: IconManifest = {
  golang: { source: 'devicon', light: 'golang.svg', dark: 'golang.svg' },
  nextjs: { source: 'devicon', light: 'nextjs.svg', dark: 'nextjs.svg', tile: { dark: true } },
  deno: { source: 'simple-icons', light: 'deno.svg', dark: 'deno.dark.svg' },
  midtrans: { source: 'lucide', light: 'midtrans.svg', dark: 'midtrans.dark.svg', fallback: true },
  'lucide-plug': { source: 'lucide', light: 'lucide-plug.svg', dark: 'lucide-plug.dark.svg', fallback: true },
}

describe('the icon shown for a catalog entry', () => {
  it('is the same file in both themes when the logo reads on both', () => {
    expect(pickIcon(manifest, 'golang', 'light')).toEqual({ file: 'golang.svg', tile: false, fallback: false, source: 'devicon' })
    expect(pickIcon(manifest, 'golang', 'dark')).toMatchObject({ file: 'golang.svg', tile: false })
  })

  it('switches to the theme variant, or puts the logo on a tile, where it would fade', () => {
    expect(pickIcon(manifest, 'deno', 'dark')).toMatchObject({ file: 'deno.dark.svg', tile: false })
    expect(pickIcon(manifest, 'nextjs', 'dark')).toMatchObject({ file: 'nextjs.svg', tile: true })
    expect(pickIcon(manifest, 'nextjs', 'light')).toMatchObject({ tile: false })
  })

  it('marks a logo that is not in yet', () => {
    expect(pickIcon(manifest, 'midtrans', 'light')).toMatchObject({ fallback: true })
  })

  it('shows the subkind icon for a slug it does not know', () => {
    expect(pickIcon(manifest, 'unknown-thing', 'light', 'external')).toMatchObject({ file: 'lucide-plug.svg', fallback: true })
    expect(pickIcon(manifest, 'unknown-thing', 'light')).toBeNull()
  })
})
