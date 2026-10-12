import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { searchDocuments } from '@/lib/domain-api'
import { useWorkspaces } from '@/features/workspaces/hooks/use-workspaces'
import { useDebouncedValue } from './use-debounced-value'

const MIN_QUERY_LENGTH = 2

/**
 * Server-side document search for the command menu. Nothing is requested until
 * `enabled`, so a closed menu costs no traffic. A single letter keeps showing the
 * recent documents instead of searching.
 */
export function useDocumentSearch(rawQuery: string, enabled: boolean) {
  const { activeWorkspaceId } = useWorkspaces()
  const trimmed = rawQuery.trim()
  const debounced = useDebouncedValue(trimmed, 200)
  const query = debounced.length >= MIN_QUERY_LENGTH ? debounced : ''
  const results = useQuery({
    queryKey: ['document-search', activeWorkspaceId, query],
    queryFn: ({ signal }) => searchDocuments(activeWorkspaceId, query, signal),
    enabled: enabled && Boolean(activeWorkspaceId),
    staleTime: 30_000,
    gcTime: 60_000,
    placeholderData: keepPreviousData,
  })
  return {
    hits: results.data ?? [],
    isLoading: results.isLoading,
    isFetching: results.isFetching,
    isError: results.isError,
    retry: () => void results.refetch(),
  }
}
