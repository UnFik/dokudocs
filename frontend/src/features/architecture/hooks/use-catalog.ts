import { useQuery } from '@tanstack/react-query'
import { fetchCatalog } from '../api/catalog-api'
import type { CatalogEntry } from '../lib/catalog'

/** The catalog changes only with a release; it is read once per hour at most. */
export function useCatalog() {
  return useQuery({
    queryKey: ['architecture-catalog'],
    queryFn: ({ signal }) => fetchCatalog(signal),
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
  })
}

export function catalogIndex(entries: CatalogEntry[] | undefined) {
  return new Map((entries ?? []).map((e) => [e.slug, e]))
}
