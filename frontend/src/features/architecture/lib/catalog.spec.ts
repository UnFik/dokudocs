import { describe, expect, it } from 'vitest'
import { groupCatalog, protocolFamilies, suggestedProtocols, type CatalogEntry } from './catalog'

const e = (slug: string, category: CatalogEntry['category'], subkind: string, name: string, family: string | null = null): CatalogEntry => ({
  slug, category, subkind, name, family, sortOrder: 0, deprecated: false,
})

const entries = [
  e('postgresql', 'system', 'database', 'PostgreSQL'),
  e('vps', 'host', 'compute', 'VPS'),
  e('golang', 'system', 'language', 'Go'),
  e('mysql', 'system', 'database', 'MySQL'),
  e('aws-rds', 'host', 'aws', 'AWS RDS'),
  e('old', 'system', 'database', 'Old DB'),
  e('rest', 'protocol', 'request', 'REST', 'request'),
]
entries[5]!.deprecated = true

describe('the palette sections', () => {
  it('lists Hosts then Systems in palette order, without protocols or deprecated entries', () => {
    const sections = groupCatalog(entries, '')
    expect(sections.map((s) => `${s.category}:${s.subkind}`)).toEqual(['host:compute', 'host:aws', 'system:language', 'system:database'])
    expect(sections[3]!.entries.map((x) => x.slug)).toEqual(['postgresql', 'mysql'])
  })

  it('finds entries by name or slug, ignoring case and punctuation', () => {
    expect(groupCatalog(entries, 'postgre').flatMap((s) => s.entries.map((x) => x.slug))).toEqual(['postgresql'])
    expect(groupCatalog(entries, 'AWS-rds').flatMap((s) => s.entries.map((x) => x.slug))).toEqual(['aws-rds'])
    expect(groupCatalog(entries, 'kafka')).toEqual([])
  })
})

describe('protocols suggested for a Connection', () => {
  it('follows the target', () => {
    expect(suggestedProtocols('database')).toEqual(['db-connection', 'replication', 'cdc'])
    expect(suggestedProtocols('broker')).toEqual(['publish', 'subscribe'])
    expect(suggestedProtocols('frontend')).toEqual(['rest', 'websocket', 'sse'])
    expect(suggestedProtocols('external')).toEqual(['rest', 'webhook', 'smtp'])
  })

  it('falls back to service protocols for an unknown target', () => {
    expect(suggestedProtocols(undefined)).toEqual(['rest', 'grpc', 'graphql', 'websocket'])
  })

  it('groups every protocol by family for the full list', () => {
    expect(protocolFamilies(entries)).toEqual([{ family: 'request', entries: [entries[6]] }])
  })
})
