import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DocumentItem } from '@/types/dokudocs'
import { toast } from 'sonner'
import {
  emptyTrash,
  listTrash,
  moveDocumentToTrash,
  permanentlyDeleteDocument,
  restoreDocument,
} from '@/lib/domain-api'
import { useWorkspaces } from '@/features/workspaces/hooks/use-workspaces'

type TrashTarget = Pick<DocumentItem, 'id' | 'orgId' | 'title'>

/** The Trash page, the cards and the sidebar all read these two queries. */
function useRefreshDocuments() {
  const queryClient = useQueryClient()
  return (workspaceId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['documents', workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ['trash', workspaceId] }),
    ])
}

export function useTrashItems() {
  const { activeWorkspaceId } = useWorkspaces()
  return useQuery({
    queryKey: ['trash', activeWorkspaceId],
    queryFn: ({ signal }) => listTrash(activeWorkspaceId, signal),
    enabled: Boolean(activeWorkspaceId),
  })
}

export function useRestoreDocument() {
  const refresh = useRefreshDocuments()
  return useMutation({
    mutationFn: (document: TrashTarget) =>
      restoreDocument(document.orgId, document.id),
    onSuccess: async (_, document) => {
      await refresh(document.orgId)
      toast.success(`"${document.title}" restored`)
    },
    onError: (error) => toast.error(error.message),
  })
}

export function useMoveToTrash() {
  const refresh = useRefreshDocuments()
  const restore = useRestoreDocument()
  return useMutation({
    mutationFn: (document: TrashTarget) =>
      moveDocumentToTrash(document.orgId, document.id),
    onSuccess: async (_, document) => {
      await refresh(document.orgId)
      toast.success('Moved document to Trash', {
        action: { label: 'Undo', onClick: () => restore.mutate(document) },
      })
    },
    onError: (error) => toast.error(error.message),
  })
}

export function usePermanentlyDeleteDocument() {
  const refresh = useRefreshDocuments()
  return useMutation({
    mutationFn: (document: TrashTarget) =>
      permanentlyDeleteDocument(document.orgId, document.id),
    onSuccess: async (_, document) => {
      await refresh(document.orgId)
      toast.success(`"${document.title}" deleted permanently`)
    },
    onError: (error) => toast.error(error.message),
  })
}

export function useEmptyTrash() {
  const refresh = useRefreshDocuments()
  return useMutation({
    mutationFn: (workspaceId: string) => emptyTrash(workspaceId),
    onSuccess: async (_, workspaceId) => {
      await refresh(workspaceId)
      toast.success('Trash emptied successfully')
    },
    onError: (error) => toast.error(error.message),
  })
}
