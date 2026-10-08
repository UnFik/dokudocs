// Picks the icon file for a catalog slug and theme from the manifest written by
// scripts/catalog-icons/build.py (catalog doc, "Light and dark themes").

export type IconManifestEntry = {
  source: string
  light: string
  dark: string
  tile?: { light?: boolean; dark?: boolean }
  fallback?: boolean
}
export type IconManifest = Record<string, IconManifestEntry>
export type Theme = 'light' | 'dark'
export type PickedIcon = {
  file: string
  tile: boolean
  fallback: boolean
  source: string
}

// The Lucide icon each subkind falls back to, for a slug the manifest does not know.
const SUBKIND_ICON: Record<string, string> = {
  compute: 'server',
  orchestration: 'layers',
  network: 'network',
  aws: 'cloud',
  gcp: 'cloud',
  azure: 'cloud',
  paas: 'cloud',
  client: 'monitor',
  language: 'code-xml',
  frontend: 'app-window',
  backend: 'server',
  mobile: 'smartphone',
  database: 'database',
  cache: 'zap',
  search: 'search',
  broker: 'mail',
  gateway: 'route',
  storage: 'hard-drive',
  auth: 'lock',
  observability: 'activity',
  ai: 'brain-circuit',
  job: 'cog',
  external: 'plug',
}

export function pickIcon(
  manifest: IconManifest,
  slug: string | null,
  theme: Theme,
  subkind?: string
): PickedIcon | null {
  const entry =
    (slug && manifest[slug]) ||
    (subkind ? manifest[`lucide-${SUBKIND_ICON[subkind] ?? ''}`] : undefined)
  if (!entry) return null
  const known = Boolean(slug && manifest[slug])
  return {
    file: entry[theme],
    tile: Boolean(entry.tile?.[theme]),
    fallback: !known || Boolean(entry.fallback),
    source: entry.source,
  }
}
