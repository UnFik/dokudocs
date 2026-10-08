import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DocumentItem, DocumentRevision } from '@/types/dokudocs'
import { toast } from 'sonner'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import {
  createNamedDocumentRevision,
  getDocument,
  listDocumentRevisions,
  restoreDocumentRevision,
  updateDocumentMetadata,
} from '@/lib/domain-api'
import { useTheme } from '@/context/theme-provider'
import { Button } from '@/components/ui/button'
import { ArchitectureUses } from '@/features/architecture/components/architecture-uses'
import { useCurrentProfile } from '@/features/auth/hooks/use-current-profile'
import { useSourceSession } from '../hooks/use-source-session'
import {
  copyDiagramSvg,
  exportDiagramPng,
  exportDiagramSvg,
  getDiagramSvg,
} from '../lib/diagram-export'
import { DbmlEditor } from './dbml-editor'
import { MermaidExportDialog } from './dialogs/mermaid-export-dialog'
import { PublicShareDialog } from './dialogs/public-share-dialog'
import { EditorHeader } from './editor-header'
import { MermaidEditor } from './mermaid-editor'
import { RecoveryCopyNotice } from './recovery-copy-notice'
import type { SourceCollab } from './unified-monaco-editor'
import { VersionHistorySidebar } from './version-history-sidebar'

/**
 * A DBML or Mermaid document edited together (ADR 0033). The editor opens the
 * document's current record; a restore gives it a new one, and the editor
 * reopens on that, keeping unsent source as a recovery copy.
 */
export function RemoteSourceDocEditor({
  document: doc,
  workspaceID,
  userID,
  offline = false,
}: {
  document: DocumentItem
  workspaceID: string
  userID: string
  offline?: boolean
}) {
  const queryClient = useQueryClient()
  const [record, setRecord] = useState(doc.replacementId)
  const [replacedOffline, setReplacedOffline] = useState(false)

  // A restore replaced the record: read which record the document holds now.
  const reopen = async () => {
    try {
      const current = await getDocument(workspaceID, doc.id)
      useDokudocsStore.getState().upsertDocument({ ...current, content: '' })
      queryClient.setQueryData(
        ['document', workspaceID, doc.id, userID],
        current
      )
      setReplacedOffline(false)
      setRecord(current.replacementId)
    } catch {
      setReplacedOffline(true)
    }
  }

  if (replacedOffline || !record)
    return (
      <div className='flex h-[70vh] flex-col items-center justify-center gap-3 px-4 text-center'>
        <h2 className='text-sm font-semibold'>This diagram was restored</h2>
        <p role='alert' className='max-w-md text-[13px] text-muted-foreground'>
          Someone restored an earlier version while this device was offline.
          Edits it had not sent are kept for you. Reconnect to open the restored
          diagram.
        </p>
        <Button size='sm' variant='outline' onClick={() => void reopen()}>
          Try again
        </Button>
      </div>
    )

  return (
    <SourceEditor
      key={record}
      document={doc}
      record={record}
      workspaceID={workspaceID}
      userID={userID}
      offline={offline}
      onReplaced={() => void reopen()}
    />
  )
}

function SourceEditor({
  document: doc,
  record,
  workspaceID,
  userID,
  offline,
  onReplaced,
}: {
  document: DocumentItem
  record: string
  workspaceID: string
  userID: string
  offline: boolean
  onReplaced: () => void
}) {
  const queryClient = useQueryClient()
  const { resolvedTheme } = useTheme()
  const { name: userName } = useCurrentProfile()
  const [title, setTitle] = useState(doc.title)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isMermaidExportOpen, setIsMermaidExportOpen] = useState(false)
  const [isShareOpen, setIsShareOpen] = useState(false)
  // The preview follows the shared text; it never writes it.
  const [, setPreviewSource] = useState('')
  const session = useSourceSession({
    workspaceID,
    documentID: doc.id,
    record,
    userID,
    userName,
    title,
    onReplaced,
  })

  const canEdit =
    Boolean(session.access?.canEdit) &&
    session.status !== 'forbidden' &&
    session.status !== 'unauthorized'
  const collab = useMemo<SourceCollab | undefined>(
    () =>
      session.text
        ? {
            text: session.text,
            awareness: session.awareness,
            readOnly: !canEdit,
          }
        : undefined,
    [session.text, session.awareness, canEdit]
  )

  const titleMutation = useMutation({
    mutationFn: (next: string) =>
      updateDocumentMetadata(workspaceID, doc.id, { title: next }),
    onSuccess: (updated) => {
      setTitle(updated.title)
      void queryClient.invalidateQueries({
        queryKey: ['document', workspaceID, doc.id],
      })
    },
    onError: (error) => toast.error(error.message),
  })

  const revisionsQuery = useQuery({
    queryKey: ['document-revisions', workspaceID, doc.id],
    queryFn: ({ signal }) => listDocumentRevisions(workspaceID, doc.id, signal),
    enabled: isHistoryOpen && !offline,
    retry: false,
  })
  const createRevision = useMutation({
    mutationFn: async (name: string) => {
      // A named version holds what the database holds; wait until it has every edit.
      if (!(await session.flushed()))
        throw new Error(
          'Your latest edits are not saved yet. Name the version once they are.'
        )
      return createNamedDocumentRevision(workspaceID, doc.id, name)
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['document-revisions', workspaceID, doc.id],
      }),
  })
  // One request id per revision, so a retried restore is the same restore.
  const restoreIDs = useRef(new Map<string, string>())
  const restore = useMutation({
    mutationFn: ({
      revisionID,
      requestID,
    }: {
      revisionID: string
      requestID: string
    }) => restoreDocumentRevision(workspaceID, doc.id, revisionID, requestID),
    onSuccess: async (_result, { revisionID }) => {
      restoreIDs.current.delete(revisionID)
      await queryClient.invalidateQueries({
        queryKey: ['document-revisions', workspaceID, doc.id],
      })
      toast.success('Diagram restored from the revision')
      session.reopen()
    },
    onError: (error) => toast.error(error.message),
  })
  const restoreRevision = (revision: DocumentRevision) => {
    const requestID = restoreIDs.current.get(revision.id) ?? crypto.randomUUID()
    restoreIDs.current.set(revision.id, requestID)
    restore.mutate({ revisionID: revision.id, requestID })
  }

  const extension = doc.type === 'dbdiagram' ? 'dbml' : 'mmd'
  const exportCode = () => {
    navigator.clipboard.writeText(session.source)
    toast.success('Document raw code copied to clipboard')
  }

  const connection = session.synced
    ? canEdit
      ? 'Editing together'
      : 'Viewing'
    : session.status === 'offline' || offline
      ? 'Offline: changes are kept on this device'
      : 'Connecting…'

  return (
    <div className='flex h-screen w-full flex-col overflow-hidden bg-background'>
      <EditorHeader
        docId={doc.id}
        title={title}
        type={doc.type}
        projectId={doc.projectId ?? null}
        projectName={doc.projectName}
        category={doc.category}
        categories={doc.categories}
        isSaving={titleMutation.isPending || session.saveState === 'saving'}
        isDirty={
          session.saveState === 'failed' || session.saveState === 'offline'
        }
        lastSaved={session.lastSaved ?? new Date(doc.updatedAt)}
        onTitleChange={(next) => titleMutation.mutate(next)}
        // Renaming goes through the server, which an offline device cannot reach.
        titleReadOnly={!canEdit || offline}
        presenceUsers={session.presence}
        currentUserID={userID}
        onToggleHistory={
          offline ? undefined : () => setIsHistoryOpen((open) => !open)
        }
        isHistoryOpen={isHistoryOpen}
        onOpenShare={
          !doc.isDraft && canEdit && !offline
            ? () => setIsShareOpen(true)
            : undefined
        }
        onExportDiagram={
          doc.type === 'mermaid'
            ? () => setIsMermaidExportOpen(true)
            : undefined
        }
        onExportCode={exportCode}
        onExportCopySvg={copyDiagramSvg}
        onExportSvg={() => exportDiagramSvg(title)}
        onExportPng={() => exportDiagramPng(title, resolvedTheme === 'dark')}
      />
      <ArchitectureUses
        workspaceID={workspaceID}
        documentID={doc.id}
        className='border-b border-border px-4 py-1.5'
      />
      {session.status === 'forbidden' && (
        <div
          role='alert'
          className='border-b border-border px-4 py-2 text-[13px]'
        >
          You no longer have access to this diagram. Ask its owner to share it
          with you.
        </div>
      )}
      {session.saveState === 'failed' && (
        <div
          role='alert'
          className='flex items-center gap-2 border-b border-border px-4 py-2 text-[13px]'
        >
          <i
            className='size-1.5 shrink-0 rounded-[1px] bg-destructive'
            aria-hidden
          />
          Your latest edits are not saved yet. They stay on this device and are
          sent again when the server answers.
        </div>
      )}
      <RecoveryCopyNotice documentID={doc.id} extension={extension} />
      <div className='flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground'>
        <span>{connection}</span>
        <span aria-hidden>·</span>
        <span className='font-mono'>{extension}</span>
      </div>

      <div className='flex-1 overflow-hidden'>
        {!collab ? (
          <div className='p-6 text-sm text-muted-foreground'>
            Loading diagram…
          </div>
        ) : doc.type === 'dbdiagram' ? (
          <DbmlEditor
            docId={doc.id}
            content={session.source}
            onChange={setPreviewSource}
            collab={collab}
          />
        ) : (
          <MermaidEditor
            docId={doc.id}
            content={session.source}
            onChange={setPreviewSource}
            collab={collab}
          />
        )}
      </div>

      <VersionHistorySidebar
        docId={doc.id}
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        revisions={revisionsQuery.data ?? []}
        canEdit={canEdit}
        isLoading={isHistoryOpen && revisionsQuery.isPending}
        loadError={
          revisionsQuery.error instanceof Error
            ? revisionsQuery.error.message
            : ''
        }
        isSaving={createRevision.isPending}
        isRestoring={restore.isPending}
        onCreateSnapshot={(name) => createRevision.mutateAsync(name)}
        onRestoreRevision={restoreRevision}
        renderPreview={(revision) => (
          <pre className='max-h-64 overflow-auto rounded-[6px] border border-border bg-background p-2 font-mono text-[11px] whitespace-pre-wrap'>
            {revision.content || 'Empty'}
          </pre>
        )}
      />

      <PublicShareDialog
        open={isShareOpen}
        onOpenChange={setIsShareOpen}
        workspaceID={workspaceID}
        documentID={doc.id}
      />

      {doc.type === 'mermaid' && (
        <MermaidExportDialog
          open={isMermaidExportOpen}
          onOpenChange={setIsMermaidExportOpen}
          docTitle={title}
          content={session.source}
          svg={isMermaidExportOpen ? getDiagramSvg() || '' : ''}
        />
      )}
    </div>
  )
}
