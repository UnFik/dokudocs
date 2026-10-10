import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DocumentItem, DocumentRevision } from '@/types/dokudocs'
import * as monaco from 'monaco-editor'
import { toast } from 'sonner'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import {
  createNamedDocumentRevision,
  getDocument,
  listDocumentComments,
  listDocumentRevisions,
  restoreDocumentRevision,
  updateDocumentMetadata,
  type SourceCommentAnchor,
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
import {
  trackSourceComments,
  type SourceCommentMarks,
  type SourceRanges,
} from '../lib/source-comment-marks'
import { DbmlEditor } from './dbml-editor'
import { MermaidExportDialog } from './dialogs/mermaid-export-dialog'
import { PublicShareDialog } from './dialogs/public-share-dialog'
import { EditorHeader } from './editor-header'
import { MermaidEditor } from './mermaid-editor'
import { RecoveryCopyNotice } from './recovery-copy-notice'
import { SourceCommentsPanel } from './source-comments-panel'
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
  focusThreadID,
}: {
  document: DocumentItem
  workspaceID: string
  userID: string
  offline?: boolean
  /** A comment thread to open, from a notification. */
  focusThreadID?: string
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
      focusThreadID={focusThreadID}
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
  focusThreadID,
  onReplaced,
}: {
  document: DocumentItem
  record: string
  workspaceID: string
  userID: string
  offline: boolean
  focusThreadID?: string
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
  const [isCommentsOpen, setIsCommentsOpen] = useState(false)
  const [editor, setEditor] =
    useState<monaco.editor.IStandaloneCodeEditor | null>(null)
  const [ranges, setRanges] = useState<SourceRanges>(new Map())
  const [hasSelection, setHasSelection] = useState(false)
  const [focusedComment, setFocusedComment] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState<{
    selectedText: string
    anchor: SourceCommentAnchor
  } | null>(null)
  const marksRef = useRef<SourceCommentMarks | null>(null)
  const fromRemoteComments = useRef(false)
  const session = useSourceSession({
    workspaceID,
    documentID: doc.id,
    record,
    userID,
    userName,
    title,
    onReplaced,
    onCommentsChanged: () => {
      // A change that came from someone else must not be announced again.
      fromRemoteComments.current = true
      void queryClient.invalidateQueries({
        queryKey: ['document-comments', workspaceID, doc.id],
      })
      fromRemoteComments.current = false
    },
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
            onEditor: setEditor,
          }
        : undefined,
    [session.text, session.awareness, canEdit]
  )
  const canComment = Boolean(session.access?.canComment) && !offline

  const commentsQuery = useQuery({
    queryKey: ['document-comments', workspaceID, doc.id],
    queryFn: ({ signal }) => listDocumentComments(workspaceID, doc.id, signal),
    enabled: !offline,
    retry: false,
    refetchOnWindowFocus: true,
  })
  const threads = useMemo(() => commentsQuery.data ?? [], [commentsQuery.data])
  // This person's own comment changes are told to the others in the room.
  const signalComments = session.signalComments
  useEffect(() => {
    return queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type === 'updated' &&
        event.action.type === 'invalidate' &&
        event.query.queryKey[0] === 'document-comments' &&
        event.query.queryKey[2] === doc.id &&
        !fromRemoteComments.current
      )
        signalComments()
    })
  }, [queryClient, doc.id, signalComments])

  const startDraft = useCallback(() => {
    const picked = marksRef.current?.anchorSelection()
    if (!picked) {
      toast.error('Select the source to comment on first.', {
        id: 'comment-draft',
      })
      return
    }
    setCommentDraft(picked)
    setIsCommentsOpen(true)
  }, [])

  // Marks on the words of each open thread, kept on the words as the source changes.
  useEffect(() => {
    if (!editor || !session.text) return
    const marks = trackSourceComments({
      editor,
      text: session.text,
      onRanges: setRanges,
    })
    marksRef.current = marks
    const clicked = editor.onMouseDown((event) => {
      const id = event.target.position
        ? marks.threadAt(event.target.position)
        : null
      if (!id) return
      setFocusedComment(id)
      setIsCommentsOpen(true)
    })
    const selected = editor.onDidChangeCursorSelection(() =>
      setHasSelection(!editor.getSelection()?.isEmpty())
    )
    const shortcut = editor.addAction({
      id: 'dokudocs.source.comment',
      label: 'Comment on selection',
      keybindings: [
        // Ctrl+Alt+M, the same as in a Markdown document.
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyM,
      ],
      run: () => startDraft(),
    })
    return () => {
      clicked.dispose()
      selected.dispose()
      shortcut.dispose()
      marks.destroy()
      marksRef.current = null
    }
  }, [editor, session.text, startDraft])
  useEffect(() => {
    marksRef.current?.setThreads(
      threads.flatMap((thread) =>
        thread.sourceAnchor
          ? [
              {
                id: thread.id,
                anchor: thread.sourceAnchor,
                resolved: Boolean(thread.resolvedAt),
              },
            ]
          : []
      )
    )
  }, [threads, editor, session.text])
  useEffect(() => {
    marksRef.current?.setFocused(focusedComment)
  }, [focusedComment, threads, editor])

  // A notification opens the thread it is about: the panel and its card at once,
  // and the words once they are marked.
  const [openedFor, setOpenedFor] = useState<string | null>(null)
  const wanted =
    focusThreadID && openedFor !== focusThreadID
      ? threads.find((item) => item.id === focusThreadID && item.sourceAnchor)
      : undefined
  if (wanted) {
    setOpenedFor(wanted.id)
    setIsCommentsOpen(true)
    setFocusedComment(wanted.id)
  }
  const revealed = useRef<string | null>(null)
  useEffect(() => {
    if (!focusThreadID || revealed.current === focusThreadID) return
    const thread = threads.find((item) => item.id === focusThreadID)
    // A resolved thread has no words marked; there is nothing to wait for.
    if (thread?.resolvedAt || marksRef.current?.reveal(focusThreadID))
      revealed.current = focusThreadID
  }, [focusThreadID, threads, ranges])
  const selectComment = (id: string) => {
    setFocusedComment(id)
    marksRef.current?.reveal(id)
  }
  const openCommentCount = threads.filter(
    (thread) => thread.sourceAnchor && !thread.resolvedAt
  ).length

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
        onToggleComments={() => setIsCommentsOpen((open) => !open)}
        isCommentsOpen={isCommentsOpen}
        commentsCount={openCommentCount}
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

      <div className='flex flex-1 overflow-hidden'>
        <div className='min-w-0 flex-1 overflow-hidden'>
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
        {isCommentsOpen && (
          <SourceCommentsPanel
            workspaceID={workspaceID}
            documentID={doc.id}
            userID={userID}
            threads={threads}
            ranges={ranges}
            loading={commentsQuery.isPending && !offline}
            failed={Boolean(commentsQuery.error) || offline}
            canComment={canComment}
            canDecide={canEdit}
            hasSelection={hasSelection}
            draft={commentDraft}
            focusedID={focusedComment}
            onSelect={selectComment}
            onStartDraft={startDraft}
            onDraftDone={() => setCommentDraft(null)}
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
