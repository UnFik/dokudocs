import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { DocumentItem } from '@/types/dokudocs'
import { toast } from 'sonner'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { toggleDocumentStar } from '@/lib/domain-api'

/**
 * Stars or unstars a document on the server. The cards, the list and the
 * sidebar read documents from the `['documents', workspace]` query, and an open
 * document is also kept in the local store, so both are updated from the answer.
 */
export function useToggleDocumentStar() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (document: Pick<DocumentItem, 'id' | 'orgId' | 'title'>) =>
      toggleDocumentStar(document.orgId, document.id),
    onSuccess: async (isStarred, document) => {
      const starredAt = isStarred ? new Date().toISOString() : null
      const queryKey = ['documents', document.orgId]
      queryClient.setQueryData<DocumentItem[]>(queryKey, (documents) =>
        documents?.map((row) =>
          row.id === document.id ? { ...row, isStarred, starredAt } : row
        )
      )
      useDokudocsStore.setState((state) => ({
        documents: (state.documents || []).map((row) =>
          row.id === document.id ? { ...row, isStarred, starredAt } : row
        ),
      }))
      await queryClient.invalidateQueries({ queryKey })
      toast.success(
        `${isStarred ? 'Starred' : 'Unstarred'} "${document.title}"`
      )
    },
    onError: (error) => toast.error(error.message),
  })
}
