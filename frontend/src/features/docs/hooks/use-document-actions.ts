import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { DocumentItem } from '@/types/dokudocs'
import { toast } from 'sonner'
import {
  addProjectCategory,
  duplicateDocument,
  moveDocument,
  recordDocumentView,
  updateDocumentMetadata,
  type UpdateDocumentMetadataInput,
} from '@/lib/domain-api'

type DocumentRef = Pick<DocumentItem, 'id' | 'orgId' | 'title'>

function useRefreshDocuments() {
  const queryClient = useQueryClient()
  return (workspaceId: string) =>
    queryClient.invalidateQueries({ queryKey: ['documents', workspaceId] })
}

/** Rename and category changes. Categories must already exist in the project. */
export function useUpdateDocument() {
  const refresh = useRefreshDocuments()
  return useMutation({
    mutationFn: ({
      document,
      input,
    }: {
      document: DocumentRef
      input: UpdateDocumentMetadataInput
      message?: string
    }) => updateDocumentMetadata(document.orgId, document.id, input),
    onSuccess: async (_, { document, message }) => {
      await refresh(document.orgId)
      if (message) toast.success(message)
    },
    onError: (error) => toast.error(error.message),
  })
}

export function useDuplicateDocument() {
  const refresh = useRefreshDocuments()
  return useMutation({
    mutationFn: (document: DocumentRef) =>
      duplicateDocument(document.orgId, document.id, crypto.randomUUID()),
    onSuccess: async (_, document) => {
      await refresh(document.orgId)
      toast.success('Document duplicated successfully')
    },
    onError: (error) => toast.error(error.message),
  })
}

export function useMoveDocument() {
  const refresh = useRefreshDocuments()
  return useMutation({
    mutationFn: ({
      document,
      targetProjectId,
    }: {
      document: DocumentRef
      targetProjectId: string | null
      targetName?: string
    }) => moveDocument(document.orgId, document.id, targetProjectId),
    onSuccess: async (_, { document, targetProjectId, targetName }) => {
      await refresh(document.orgId)
      toast.success(
        targetProjectId
          ? `Moved "${document.title}" to "${targetName || 'Project'}"`
          : `Moved "${document.title}" to Drafts`
      )
    },
    onError: (error) => toast.error(error.message),
  })
}

export function useAddProjectCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      name,
    }: {
      workspaceId: string
      projectId: string
      name: string
    }) => addProjectCategory(workspaceId, projectId, name),
    onSuccess: (_, { workspaceId }) =>
      queryClient.invalidateQueries({ queryKey: ['projects', workspaceId] }),
    onError: (error) => toast.error(error.message),
  })
}

/**
 * Opening a document feeds Recent; a failed write must not block navigation.
 * The lists are only marked stale: refetching them now would re-render the
 * editor that is open, and the next list to mount refetches anyway.
 */
export function useRecordDocumentView() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (document: Pick<DocumentItem, 'id' | 'orgId'>) =>
      recordDocumentView(document.orgId, document.id),
    onSuccess: (_, document) =>
      queryClient.invalidateQueries({
        queryKey: ['documents', document.orgId],
        refetchType: 'none',
      }),
  })
}
