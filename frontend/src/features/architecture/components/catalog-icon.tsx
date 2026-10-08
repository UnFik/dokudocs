import manifestJSON from '@/assets/catalog/manifest.json'
import { cn } from '@/lib/utils'
import { useTheme } from '@/context/theme-provider'
import { pickIcon, type IconManifest } from '../lib/catalog-icon'

const manifest = manifestJSON as IconManifest
// Every icon is a file next to the manifest; Vite gives each a URL and loads it only when shown.
const urls = import.meta.glob('/src/assets/catalog/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

/**
 * The logo of a catalog entry in the current theme. A logo that would fade into
 * this theme's surface sits on a contrasting tile (catalog doc, "Light and dark themes").
 */
export function CatalogIcon({
  slug,
  subkind,
  label,
  size = 20,
  className,
}: {
  slug: string | null
  subkind?: string
  /** Read by screen readers; leave it out where the name is written next to the icon. */
  label?: string
  size?: number
  className?: string
}) {
  const { resolvedTheme } = useTheme()
  const icon = pickIcon(manifest, slug, resolvedTheme, subkind)
  const src = icon ? urls[`/src/assets/catalog/${icon.file}`] : undefined
  return (
    <span
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-[4px]',
        icon?.tile && (resolvedTheme === 'dark' ? 'bg-white' : 'bg-foreground'),
        className
      )}
      style={{ width: size, height: size }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-fallback={icon?.fallback || undefined}
    >
      {src ? (
        <img
          src={src}
          alt=''
          width={size - (icon?.tile ? 4 : 2)}
          height={size - (icon?.tile ? 4 : 2)}
          draggable={false}
        />
      ) : null}
    </span>
  )
}

export function groupIconURL(theme: 'light' | 'dark') {
  return urls[
    `/src/assets/catalog/lucide-square-dashed${theme === 'dark' ? '.dark' : ''}.svg`
  ]
}
