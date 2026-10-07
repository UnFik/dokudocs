// The catalog an Architecture document draws with (docs/plans/architecture-catalog.md).

export type CatalogEntry = {
  slug: string
  category: 'host' | 'system' | 'protocol'
  subkind: string
  name: string
  family: string | null
  sortOrder: number
  deprecated: boolean
}

export type CatalogSection = { category: 'host' | 'system'; subkind: string; entries: CatalogEntry[] }

export const HOST_SUBKINDS = ['compute', 'orchestration', 'network', 'aws', 'gcp', 'azure', 'paas', 'client']
export const SYSTEM_SUBKINDS = [
  'language', 'frontend', 'backend', 'mobile', 'database', 'cache', 'search', 'broker',
  'gateway', 'storage', 'auth', 'observability', 'ai', 'job', 'external',
]
export const FAMILIES = ['request', 'stream', 'message', 'data', 'telemetry'] as const

const key = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Palette sections in palette order, filtered by a search over name and slug. */
export function groupCatalog(entries: CatalogEntry[], query: string): CatalogSection[] {
  const q = key(query)
  const visible = entries.filter(
    (e) => !e.deprecated && e.category !== 'protocol' && (!q || key(e.name).includes(q) || key(e.slug).includes(q))
  )
  const sections: CatalogSection[] = []
  for (const [category, order] of [['host', HOST_SUBKINDS], ['system', SYSTEM_SUBKINDS]] as const) {
    for (const subkind of order) {
      const inSection = visible.filter((e) => e.category === category && e.subkind === subkind)
      if (inSection.length) sections.push({ category, subkind, entries: inSection })
    }
  }
  return sections
}

const SERVICE = ['rest', 'grpc', 'graphql', 'websocket']
const CLIENT = ['rest', 'websocket', 'sse']
const SUGGESTED: Record<string, string[]> = {
  backend: SERVICE, language: SERVICE, job: SERVICE, frontend: CLIENT, mobile: CLIENT,
  gateway: ['http', 'rest', 'grpc'], database: ['db-connection', 'replication', 'cdc'], cache: ['cache-connection'],
  search: ['rest', 'batch-import'], broker: ['publish', 'subscribe'], storage: ['object-storage', 'file-share', 'sftp'],
  auth: ['oidc', 'ldap'], observability: ['otlp', 'log-shipping', 'metrics-scrape'], ai: ['rest', 'grpc'],
  external: ['rest', 'webhook', 'smtp'],
}

/** The protocols listed first when a Connection points at a System of this subkind. Nothing is refused. */
export function suggestedProtocols(targetSubkind: string | undefined): string[] {
  return (targetSubkind && SUGGESTED[targetSubkind]) || SERVICE
}

export function protocolFamilies(entries: CatalogEntry[]) {
  return FAMILIES.map((family) => ({
    family,
    entries: entries.filter((e) => e.category === 'protocol' && e.family === family && !e.deprecated),
  })).filter((group) => group.entries.length)
}

/** The family of a protocol slug, which sets the line style. */
export function familyOf(entries: CatalogEntry[] | undefined, protocol: string): string {
  return entries?.find((e) => e.slug === protocol)?.family ?? 'request'
}
