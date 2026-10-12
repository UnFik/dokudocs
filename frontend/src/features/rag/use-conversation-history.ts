import { useInfiniteQuery } from '@tanstack/react-query'
import { getRAGConversation } from '@/lib/domain-api'

/**
 * A conversation read newest page first. Older pages are fetched on demand and
 * sit above the ones already loaded. After the cache is refreshed each page is
 * read again from the cursor of the page before it, so a message added since
 * moves the pages along instead of leaving a gap between them.
 */
export function useConversationHistory(
  userID: string,
  conversationID: string | undefined
) {
  const queryKey = ['rag-conversation', userID, conversationID]
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ signal, pageParam }) =>
      getRAGConversation(conversationID!, signal, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(userID && conversationID),
    retry: false,
  })
  const pages = query.data?.pages
  const newest = pages?.[0]
  const history = newest
    ? {
        conversation: newest.conversation,
        actions: newest.actions,
        messages: [...pages!].reverse().flatMap((page) => page.messages),
      }
    : undefined
  return {
    queryKey,
    history,
    isPending: query.isPending,
    error: query.error,
    hasOlder: query.hasNextPage,
    loadingOlder: query.isFetchingNextPage,
    loadOlder: () => {
      if (query.hasNextPage && !query.isFetchingNextPage)
        void query.fetchNextPage()
    },
  }
}
