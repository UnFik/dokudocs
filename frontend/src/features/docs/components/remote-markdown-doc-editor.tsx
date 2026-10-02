import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DocumentItem, DocumentRevision } from '@/types/dokudocs'
import { Eye, Edit3 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { useEditorPreferenceStore } from '@/stores/editor-preference-store'
import { ApiError } from '@/lib/api-client'
import {
  acceptDocumentSuggestion,
  createDocumentSuggestion,
  createNamedDocumentRevision,
  getMarkdownBody,
  listDocumentSuggestions,
  listDocumentRevisions,
  rejectDocumentSuggestion,
  restoreDocumentRevision,
  updateDocumentMetadata,
} from '@/lib/domain-api'
import { useMountEffect } from '@/hooks/use-mount-effect'
import { Button } from '@/components/ui/button'
import type { CollaborativeDocumentStatus } from '../lib/collaboration-provider'
import {
  clearLocalMarkdown,
  loadOfflineMarkdownBody,
  recoverPendingMarkdown,
} from '../lib/collaboration-recovery'
import type { PresenceUser } from '../lib/collaboration-socket'
import type {
  PendingDeleteNodeCommand,
  PendingMoveNodeCommand,
  PendingCollaborationUpdate,
} from '../lib/collaboration-store'
import { mountCollaborativeDocumentBody } from '../lib/collaborative-document-body'
import {
  documentBodyToMarkdown,
  type DocumentBodyNode,
} from '../lib/muya/state/documentBodyToMarkdown'
import {
  buildDeleteBlockSuggestion,
  buildFormatSuggestion,
  buildInsertParagraphSuggestion,
  buildMoveBlockSuggestion,
  conflictReviewMessage,
  overlayCss,
  pendingOverlay,
  type FormatMark,
  type SuggestionDraft,
} from '../lib/suggestion-operations'
import type { EditorHistoryState } from '../lib/prosemirror/createDocumentBodyEditor'
import {
  emptyInlineState,
  type InlineMarkName,
  type InlineState,
} from '../lib/prosemirror/inlineMarks'
import { PublicShareDialog } from './dialogs/public-share-dialog'
import { HistoryButtons, SelectionToolbar } from './editor-format-toolbar'
import { EditorHeader } from './editor-header'
import './markdown-body.css'
import { MuyaEditor } from './muya-editor/MuyaEditor'
import { PresenceAvatars } from './presence-avatars'
import { VersionHistorySidebar } from './version-history-sidebar'

export function RemoteMarkdownDocEditor({
  document,
  workspaceID,
  userID,
  offline = false,
  focusNodeID,
}: {
  document: DocumentItem
  workspaceID: string
  userID: string
  offline?: boolean
  focusNodeID?: string
}) {
  const queryClient = useQueryClient()
  const bodyQuery = useQuery({
    queryKey: ['markdown-body', workspaceID, document.id, userID, offline],
    queryFn: async ({ signal }) => {
      if (offline) {
        const body = await loadOfflineMarkdownBody({
          userID,
          documentID: document.id,
        })
        if (!body)
          throw new Error('No compatible offline document body is cached')
        return body
      }
      return getMarkdownBody(workspaceID, document.id, signal)
    },
    retry: false,
  })
  const titleMutation = useMutation({
    mutationFn: (title: string) =>
      updateDocumentMetadata(workspaceID, document.id, { title }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['document', workspaceID, document.id],
      }),
    onError: (error) => toast.error(error.message),
  })
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isShareOpen, setIsShareOpen] = useState(false)
  const revisionsQuery = useQuery({
    queryKey: ['document-revisions', workspaceID, document.id],
    queryFn: ({ signal }) =>
      listDocumentRevisions(workspaceID, document.id, signal),
    enabled: isHistoryOpen && !offline,
    retry: false,
  })
  const createRevisionMutation = useMutation({
    mutationFn: (title: string) =>
      createNamedDocumentRevision(workspaceID, document.id, title),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['document-revisions', workspaceID, document.id],
      })
    },
  })
  const restoreRequestIDs = useRef(new Map<string, string>())
  const restoreRevisionMutation = useMutation({
    mutationFn: ({
      revisionID,
      requestID,
    }: {
      revisionID: string
      requestID: string
    }) =>
      restoreDocumentRevision(workspaceID, document.id, revisionID, requestID),
    onSuccess: async (_result, { revisionID }) => {
      restoreRequestIDs.current.delete(revisionID)
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['markdown-body', workspaceID, document.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ['document-revisions', workspaceID, document.id],
        }),
      ])
      toast.success('Revision restored')
    },
    onError: (error) => toast.error(error.message),
  })
  const [markdownOverride, setMarkdownOverride] = useState<string | null>(null)
  const canonicalMarkdown = useMemo(() => {
    if (!bodyQuery.data) return document.content
    try {
      return documentBodyToMarkdown(bodyQuery.data.nodes as DocumentBodyNode[])
    } catch {
      return ''
    }
  }, [bodyQuery.data, document.content])
  const markdown = markdownOverride ?? canonicalMarkdown
  const [accessUnavailable, setAccessUnavailable] = useState(false)
  const restoreRevision = (revision: DocumentRevision) => {
    const requestID =
      restoreRequestIDs.current.get(revision.id) ?? crypto.randomUUID()
    restoreRequestIDs.current.set(revision.id, requestID)
    restoreRevisionMutation.mutate({ revisionID: revision.id, requestID })
  }

  return (
    <div className='flex h-screen w-full flex-col overflow-hidden bg-background'>
      <EditorHeader
        docId={document.id}
        title={document.title}
        type='markdown'
        projectId={document.projectId ?? null}
        projectName={document.projectName}
        category={document.category}
        categories={document.categories}
        isSaving={titleMutation.isPending}
        isDirty={false}
        lastSaved={new Date(document.updatedAt)}
        onTitleChange={(title) => titleMutation.mutate(title)}
        titleReadOnly={offline || !bodyQuery.data?.canEdit || accessUnavailable}
        onToggleHistory={
          offline ? undefined : () => setIsHistoryOpen((open) => !open)
        }
        onOpenShare={
          !offline &&
          !document.isDraft &&
          bodyQuery.data?.canEdit &&
          !accessUnavailable
            ? () => setIsShareOpen(true)
            : undefined
        }
        isHistoryOpen={isHistoryOpen}
        onExportCode={
          !accessUnavailable &&
          (Boolean(bodyQuery.data) || isUninitializedBody(bodyQuery.error))
            ? () => {
                void navigator.clipboard.writeText(markdown)
                toast.success('Document Markdown copied')
              }
            : undefined
        }
      />

      {bodyQuery.isPending ? (
        <p className='p-6 text-sm text-muted-foreground'>
          Loading document body…
        </p>
      ) : bodyQuery.data ? (
        <CollaborativeMarkdownBody
          key={`${document.id}:${bodyQuery.data.bodyEpoch}:${bodyQuery.data.bodyVersion}`}
          documentID={document.id}
          workspaceID={workspaceID}
          userID={userID}
          offline={offline}
          snapshot={bodyQuery.data}
          focusNodeID={focusNodeID}
          onCanonicalBody={(body) =>
            queryClient.setQueryData(
              ['markdown-body', workspaceID, document.id, userID, offline],
              body
            )
          }
          onMarkdownChange={setMarkdownOverride}
          onAccessUnavailable={() => {
            setAccessUnavailable(true)
            setMarkdownOverride('')
          }}
        />
      ) : isUninitializedBody(bodyQuery.error) ? (
        <div className='flex min-h-0 flex-1 flex-col'>
          <p className='border-b px-6 py-3 text-sm text-muted-foreground'>
            This legacy Markdown document needs AST backfill before it can be
            edited. It is shown read-only until then.
          </p>
          <MuyaEditor
            docId={document.id}
            content={document.content}
            onChange={() => undefined}
            readOnly
            className='min-h-0 flex-1'
          />
        </div>
      ) : (
        <p role='alert' className='p-6 text-sm text-destructive'>
          Could not load the canonical document body:{' '}
          {bodyQuery.error instanceof Error
            ? bodyQuery.error.message
            : 'request failed'}
        </p>
      )}
      <VersionHistorySidebar
        docId={document.id}
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        revisions={offline ? [] : (revisionsQuery.data ?? [])}
        canEdit={bodyQuery.data?.canEdit ?? false}
        isLoading={isHistoryOpen && !offline && revisionsQuery.isPending}
        loadError={
          revisionsQuery.error instanceof Error
            ? revisionsQuery.error.message
            : ''
        }
        isSaving={createRevisionMutation.isPending}
        isRestoring={restoreRevisionMutation.isPending}
        onCreateSnapshot={(title) => createRevisionMutation.mutateAsync(title)}
        onRestoreRevision={restoreRevision}
      />
      <PublicShareDialog
        open={isShareOpen}
        onOpenChange={setIsShareOpen}
        workspaceID={workspaceID}
        documentID={document.id}
      />
    </div>
  )
}

function CollaborativeMarkdownBody({
  documentID,
  workspaceID,
  userID,
  offline,
  snapshot,
  focusNodeID,
  onCanonicalBody,
  onMarkdownChange,
  onAccessUnavailable,
}: {
  documentID: string
  workspaceID: string
  userID: string
  offline: boolean
  snapshot: Awaited<ReturnType<typeof getMarkdownBody>>
  focusNodeID?: string
  onCanonicalBody: (body: Awaited<ReturnType<typeof getMarkdownBody>>) => void
  onMarkdownChange: (markdown: string) => void
  onAccessUnavailable: () => void
}) {
  const mountRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<Awaited<
    ReturnType<typeof mountCollaborativeDocumentBody>
  > | null>(null)
  const mode = useEditorPreferenceStore(
    (state) => state.preferencesByUser[userID || 'guest']?.previewMode ?? 'edit'
  )
  const setPreviewMode = useEditorPreferenceStore(
    (state) => state.setPreviewMode
  )
  const [status, setStatus] =
    useState<CollaborativeDocumentStatus>('connecting')
  const statusRef = useRef(status)
  const [canEdit, setCanEdit] = useState(snapshot.canEdit)
  const [error, setError] = useState('')
  const [presence, setPresence] = useState<PresenceUser[]>([])
  const [recoveryPendingCount, setRecoveryPendingCount] = useState(0)
  const [isExportingRecovery, setIsExportingRecovery] = useState(false)
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false)
  const [history, setHistory] = useState<EditorHistoryState>({
    canUndo: false,
    canRedo: false,
  })
  const [inline, setInline] = useState<InlineState>(emptyInlineState)
  const [linkRequest, setLinkRequest] = useState(0)
  const modeRef = useRef(mode)
  const canEditRef = useRef(canEdit)

  function hideBodyAfterAccessLoss(clearStoredData: boolean) {
    setRecoveryPendingCount(0)
    sessionRef.current?.destroy()
    sessionRef.current = null
    mountRef.current?.replaceChildren()
    onMarkdownChange('')
    onAccessUnavailable()
    if (clearStoredData)
      void clearLocalMarkdown({ userID, documentID }).catch(() => {})
  }

  useMountEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let disposed = false

    void mountCollaborativeDocumentBody(mount, {
      documentID,
      workspaceID,
      userID,
      token: () => useAuthStore.getState().auth.accessToken,
      snapshot,
      focusNodeID,
      readOnly: modeRef.current === 'view',
      onStatus: (next) => {
        statusRef.current = next
        setStatus(next)
        if (next === 'forbidden') {
          hideBodyAfterAccessLoss(true)
          setError('Read access is no longer available.')
        } else if (next === 'unauthorized') {
          hideBodyAfterAccessLoss(false)
          setError('Sign in again to load this document.')
        }
      },
      onPresence: setPresence,
      onCanEdit: (next) => {
        canEditRef.current = next
        setCanEdit(next)
        sessionRef.current?.editor.setReadOnly(
          modeRef.current === 'view' || !next
        )
      },
      onRecovery: (
        reason,
        pending: PendingCollaborationUpdate[],
        commands: PendingDeleteNodeCommand[],
        moves: PendingMoveNodeCommand[]
      ) => {
        setRecoveryPendingCount(pending.length + commands.length + moves.length)
        setError(`Local changes need review (${reason}).`)
      },
      onCanonicalBody,
      onDeleteNodeQueued: () =>
        setError('Block deletion is queued; editing is paused until it syncs.'),
      onMoveNodeQueued: () =>
        setError('Block move is queued; editing is paused until it syncs.'),
      onBodyChange: (nodes: DocumentBodyNode[]) => {
        try {
          onMarkdownChange(documentBodyToMarkdown(nodes))
        } catch (cause) {
          setError(
            cause instanceof Error ? cause.message : 'Could not export Markdown'
          )
        }
      },
      onTransactionError: (cause) =>
        setError(cause instanceof Error ? cause.message : 'Invalid body edit'),
      onHistoryChange: setHistory,
      onInlineStateChange: setInline,
      onLinkRequest: () => setLinkRequest((count) => count + 1),
    })
      .then((session) => {
        if (disposed) {
          session.destroy()
          return
        }
        sessionRef.current = session
        onMarkdownChange(documentBodyToMarkdown(session.editor.getBody()))
        session.editor.setReadOnly(
          modeRef.current === 'view' ||
            !canEditRef.current ||
            statusRef.current === 'closed' ||
            statusRef.current === 'recovery-required'
        )
      })
      .catch((cause) => {
        if (!disposed)
          setError(
            cause instanceof Error ? cause.message : 'Collaboration failed'
          )
      })

    return () => {
      disposed = true
      sessionRef.current?.destroy()
      sessionRef.current = null
    }
  })

  const changeMode = (next: 'view' | 'edit') => {
    modeRef.current = next
    setPreviewMode(userID, next)
    sessionRef.current?.editor.setReadOnly(
      next === 'view' || !canEditRef.current
    )
  }

  const exportPendingChanges = async () => {
    setIsExportingRecovery(true)
    try {
      await getMarkdownBody(workspaceID, documentID)
      const recovered = await recoverPendingMarkdown({ userID, documentID })
      if (recovered === null) {
        setError('No unsynced local changes are available to export.')
        return
      }
      const url = URL.createObjectURL(
        new Blob([recovered], { type: 'text/markdown;charset=utf-8' })
      )
      const link = window.document.createElement('a')
      link.href = url
      link.download = `${documentID}-offline-recovery.md`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      setError('')
    } catch (cause) {
      if (cause instanceof ApiError && [403, 404].includes(cause.status)) {
        hideBodyAfterAccessLoss(true)
        setError(
          'Read access is no longer available; local changes were cleared.'
        )
      } else if (cause instanceof ApiError && cause.status === 401) {
        hideBodyAfterAccessLoss(false)
        setError(
          'Sign in again to verify access before exporting local changes.'
        )
      } else {
        setError('Could not verify access or recover local changes.')
      }
    } finally {
      setIsExportingRecovery(false)
    }
  }

  return (
    <section className='flex min-h-0 flex-1 flex-col'>
      <div className='flex items-center gap-2 border-b px-4 py-2'>
        <Button
          size='sm'
          variant={mode === 'view' ? 'secondary' : 'ghost'}
          onClick={() => changeMode('view')}
        >
          <Eye /> View
        </Button>
        <Button
          size='sm'
          variant={mode === 'edit' ? 'secondary' : 'ghost'}
          disabled={!canEdit}
          onClick={() => changeMode('edit')}
        >
          <Edit3 /> Edit
        </Button>
        {mode === 'edit' && canEdit ? (
          <HistoryButtons
            history={history}
            onUndo={() => {
              sessionRef.current?.editor.undo()
              sessionRef.current?.editor.focus()
            }}
            onRedo={() => {
              sessionRef.current?.editor.redo()
              sessionRef.current?.editor.focus()
            }}
          />
        ) : null}
        <div className='ml-auto flex items-center gap-3'>
          <PresenceAvatars users={presence} currentUserID={userID} />
          <span role='status' className='text-xs text-muted-foreground'>
            {status === 'ready'
              ? 'Synced'
              : status === 'offline'
                ? 'Offline; changes are stored on this device'
                : status}
          </span>
        </div>
      </div>
      {error ? (
        <p role='alert' className='border-b px-4 py-2 text-sm text-destructive'>
          {error}
        </p>
      ) : null}
      {status === 'recovery-required' && recoveryPendingCount > 0 ? (
        <div className='flex items-center gap-3 border-b px-4 py-2'>
          <p className='text-xs text-muted-foreground'>
            Local changes were not applied to the current document version.
          </p>
          <Button
            size='sm'
            variant='outline'
            className='ml-auto shrink-0'
            disabled={isExportingRecovery}
            onClick={() => void exportPendingChanges()}
          >
            {isExportingRecovery ? 'Checking access…' : 'Export local changes'}
          </Button>
        </div>
      ) : null}
      <div className='markdown-body min-h-0 flex-1 overflow-auto p-6'>
        <div ref={mountRef} />
      </div>
      {mode === 'edit' && canEdit ? (
        <SelectionToolbar
          inline={inline}
          linkRequest={linkRequest}
          onToggleMark={(mark: InlineMarkName) => {
            sessionRef.current?.editor.toggleMark(mark)
            sessionRef.current?.editor.focus()
          }}
          onSetLink={(href) => {
            const applied = sessionRef.current?.editor.setLink(href) ?? false
            if (applied) sessionRef.current?.editor.focus()
            return applied
          }}
          onRemoveLink={() => {
            sessionRef.current?.editor.removeLink()
            sessionRef.current?.editor.focus()
          }}
        />
      ) : null}
      {!offline && status !== 'forbidden' && status !== 'unauthorized' ? (
        <SuggestionPanel
          open={isSuggestionsOpen}
          onOpenChange={setIsSuggestionsOpen}
          workspaceID={workspaceID}
          documentID={documentID}
          canDecide={canEdit}
          canSuggest={Boolean(snapshot.canSuggest) && status === 'ready'}
          captureBlock={() => {
            if (!mountRef.current) throw new Error('Editor is not ready')
            return captureSelectedNodeID(mountRef.current)
          }}
          captureSelection={() => {
            if (!mountRef.current || !sessionRef.current)
              throw new Error('Editor is not ready')
            return captureSelectedRun(
              mountRef.current,
              sessionRef.current.editor.getBody()
            )
          }}
        />
      ) : null}
    </section>
  )
}

type TextSuggestionSelection = {
  nodeID: string
  originalContent: string
  selectedText: string
  start: number
  end: number
}

function captureSelectedRun(
  mount: HTMLElement,
  nodes: DocumentBodyNode[]
): TextSuggestionSelection {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount !== 1)
    throw new Error('Select text in one paragraph first')
  const range = selection.getRangeAt(0)
  const runAt = (node: Node) => {
    const element = node instanceof Element ? node : node.parentElement
    const run = element?.closest('span[data-node-id]')
    return run instanceof HTMLElement && mount.contains(run) ? run : null
  }
  const run = runAt(range.startContainer)
  if (!run || runAt(range.endContainer) !== run)
    throw new Error('Select text within one formatted run')
  const node = nodes.find((item) => item.nodeID === run.dataset.nodeId)
  if (!node || node.type !== 'run' || node.content !== run.textContent)
    throw new Error('Selected text is no longer current')
  const prefix = range.cloneRange()
  prefix.selectNodeContents(run)
  prefix.setEnd(range.startContainer, range.startOffset)
  const start = prefix.toString().length
  const selectedText = range.toString()
  return {
    nodeID: node.nodeID,
    originalContent: node.content,
    selectedText,
    start,
    end: start + selectedText.length,
  }
}

function captureSelectedNodeID(mount: HTMLElement): string {
  const selection = window.getSelection()
  const anchor = selection?.anchorNode
  const element = anchor instanceof Element ? anchor : anchor?.parentElement
  const target = element?.closest('[data-node-id]')
  if (!(target instanceof HTMLElement) || !mount.contains(target))
    throw new Error('Place the cursor in the block first')
  return target.dataset.nodeId as string
}

function isUninitializedBody(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    error.title === 'document body is not initialized'
  )
}

function SuggestionPanel({
  open,
  onOpenChange,
  workspaceID,
  documentID,
  canDecide,
  canSuggest,
  captureSelection,
  captureBlock,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceID: string
  documentID: string
  canDecide: boolean
  canSuggest: boolean
  captureSelection: () => TextSuggestionSelection
  captureBlock: () => string
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<TextSuggestionSelection | null>(null)
  const [replacement, setReplacement] = useState('')
  const [reason, setReason] = useState('')
  const suggestionsQuery = useQuery({
    queryKey: ['document-suggestions', workspaceID, documentID],
    queryFn: ({ signal }) =>
      listDocumentSuggestions(workspaceID, documentID, signal),
    enabled: true,
    retry: false,
  })
  const decisionMutation = useMutation({
    mutationFn: ({
      suggestionID,
      decision,
    }: {
      suggestionID: string
      decision: 'accept' | 'reject'
    }) =>
      decision === 'accept'
        ? acceptDocumentSuggestion(workspaceID, documentID, suggestionID)
        : rejectDocumentSuggestion(workspaceID, documentID, suggestionID),
    // A refused accept still changes state (the batch is marked conflicted).
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['document-suggestions', workspaceID, documentID],
      })
      await queryClient.invalidateQueries({
        queryKey: ['markdown-body', workspaceID, documentID],
      })
    },
    onError: (error) => toast.error(error.message),
  })
  const createMutation = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error('Select text first')
      if (!replacement && !draft.selectedText)
        throw new Error('Enter text to suggest')
      const latest = await getMarkdownBody(workspaceID, documentID)
      const node = latest.nodes.find((item) => item.nodeID === draft.nodeID)
      if (!latest.canSuggest || node?.content !== draft.originalContent)
        throw new Error('The selected text changed; select it again')
      const content =
        draft.originalContent.slice(0, draft.start) +
        replacement +
        draft.originalContent.slice(draft.end)
      await createDocumentSuggestion(workspaceID, documentID, {
        suggestionID: crypto.randomUUID(),
        baseBodyVersion: latest.bodyVersion,
        baseBodyEpoch: latest.bodyEpoch,
        operationSchemaVersion: 1,
        provenance: 'human',
        operations: [{ op: 'replace_text', nodeID: draft.nodeID, content }],
        summary: draft.selectedText
          ? replacement
            ? `Replace “${draft.selectedText.slice(0, 80)}” with “${replacement.slice(0, 80)}”`
            : `Delete “${draft.selectedText.slice(0, 80)}”`
          : `Insert “${replacement.slice(0, 80)}”`,
        reason,
      })
    },
    onSuccess: async () => {
      setDraft(null)
      setReason('')
      await queryClient.invalidateQueries({
        queryKey: ['document-suggestions', workspaceID, documentID],
      })
      toast.success('Suggestion submitted')
    },
    onError: (error) => toast.error(error.message),
  })
  const structureMutation = useMutation({
    mutationFn: async ({
      nodeID,
      build,
    }: {
      nodeID: string
      build: (nodes: DocumentBodyNode[], nodeID: string) => SuggestionDraft
    }) => {
      const latest = await getMarkdownBody(workspaceID, documentID)
      if (!latest.canSuggest) throw new Error('You cannot suggest changes here')
      const { operations, summary } = build(latest.nodes, nodeID)
      await createDocumentSuggestion(workspaceID, documentID, {
        suggestionID: crypto.randomUUID(),
        baseBodyVersion: latest.bodyVersion,
        baseBodyEpoch: latest.bodyEpoch,
        operationSchemaVersion: 1,
        provenance: 'human',
        operations,
        summary,
      })
    },
    onSuccess: async () => {
      setInsertAnchor(null)
      setInsertText('')
      await queryClient.invalidateQueries({
        queryKey: ['document-suggestions', workspaceID, documentID],
      })
      toast.success('Suggestion submitted')
    },
    onError: (error) => toast.error(error.message),
  })
  const [insertAnchor, setInsertAnchor] = useState<string | null>(null)
  const [insertText, setInsertText] = useState('')
  function propose(
    build: (nodes: DocumentBodyNode[], nodeID: string) => SuggestionDraft
  ) {
    try {
      structureMutation.mutate({ nodeID: captureBlock(), build })
      onOpenChange(true)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Select a block first'
      )
    }
  }
  const overlay = overlayCss(pendingOverlay(suggestionsQuery.data ?? []))
  return (
    <aside className='border-t bg-muted/20'>
      {overlay ? <style>{overlay}</style> : null}
      <div className='flex flex-wrap items-center gap-2 px-4 py-2'>
        <Button size='sm' variant='outline' onClick={() => onOpenChange(!open)}>
          {open ? 'Hide suggestions' : 'Suggestions'}
        </Button>
        {canSuggest ? (
          <Button
            size='sm'
            variant='outline'
            onClick={() => {
              try {
                const selection = captureSelection()
                setDraft(selection)
                setReplacement(selection.selectedText)
                onOpenChange(true)
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : 'Select text first'
                )
              }
            }}
          >
            Suggest change
          </Button>
        ) : null}
        {canSuggest ? (
          <div
            className='flex flex-wrap items-center gap-2'
            role='group'
            aria-label='Propose a change to the current block'
          >
            {(['bold', 'italic'] as FormatMark[]).map((mark) => (
              <Button
                key={mark}
                size='sm'
                variant='outline'
                disabled={structureMutation.isPending}
                onClick={() =>
                  propose((nodes, nodeID) =>
                    buildFormatSuggestion(nodes, nodeID, mark)
                  )
                }
              >
                Suggest {mark}
              </Button>
            ))}
            <Button
              size='sm'
              variant='outline'
              disabled={structureMutation.isPending}
              onClick={() =>
                propose((nodes, nodeID) =>
                  buildMoveBlockSuggestion(nodes, nodeID, 'up')
                )
              }
            >
              Suggest move up
            </Button>
            <Button
              size='sm'
              variant='outline'
              disabled={structureMutation.isPending}
              onClick={() =>
                propose((nodes, nodeID) =>
                  buildMoveBlockSuggestion(nodes, nodeID, 'down')
                )
              }
            >
              Suggest move down
            </Button>
            <Button
              size='sm'
              variant='outline'
              onClick={() => {
                try {
                  setInsertAnchor(captureBlock())
                  onOpenChange(true)
                } catch (error) {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : 'Select a block first'
                  )
                }
              }}
            >
              Suggest insert below
            </Button>
            <Button
              size='sm'
              variant='outline'
              disabled={structureMutation.isPending}
              onClick={() => propose(buildDeleteBlockSuggestion)}
            >
              Suggest delete block
            </Button>
          </div>
        ) : null}
        {open ? (
          <span className='text-xs text-muted-foreground'>
            Pending changes stay outside the canonical body until accepted.
          </span>
        ) : null}
      </div>
      {open ? (
        <div className='max-h-56 space-y-2 overflow-auto px-4 pb-3'>
          {insertAnchor ? (
            <form
              className='space-y-2 rounded border bg-background p-3'
              onSubmit={(event) => {
                event.preventDefault()
                structureMutation.mutate({
                  nodeID: insertAnchor,
                  build: (nodes, nodeID) =>
                    buildInsertParagraphSuggestion(
                      nodes,
                      nodeID,
                      insertText,
                      () => crypto.randomUUID()
                    ),
                })
              }}
            >
              <label className='block text-xs' htmlFor='inserted-text'>
                New paragraph text
              </label>
              <textarea
                id='inserted-text'
                className='min-h-16 w-full rounded border bg-background p-2 text-sm'
                value={insertText}
                onChange={(event) => setInsertText(event.target.value)}
              />
              <div className='flex gap-2'>
                <Button
                  size='sm'
                  type='submit'
                  disabled={structureMutation.isPending}
                >
                  Submit insert
                </Button>
                <Button
                  size='sm'
                  type='button'
                  variant='outline'
                  onClick={() => setInsertAnchor(null)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}
          {draft ? (
            <form
              className='space-y-2 rounded border bg-background p-3'
              onSubmit={(event) => {
                event.preventDefault()
                createMutation.mutate()
              }}
            >
              <p className='text-xs text-muted-foreground'>
                Selected: {draft.selectedText || '(insertion point)'}
              </p>
              <label className='block text-xs' htmlFor='suggested-text'>
                Proposed text
              </label>
              <textarea
                id='suggested-text'
                className='min-h-16 w-full rounded border bg-background p-2 text-sm'
                value={replacement}
                onChange={(event) => setReplacement(event.target.value)}
              />
              <label className='block text-xs' htmlFor='suggestion-reason'>
                Reason (optional)
              </label>
              <input
                id='suggestion-reason'
                className='w-full rounded border bg-background px-2 py-1 text-sm'
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <Button
                size='sm'
                type='submit'
                disabled={createMutation.isPending}
              >
                Submit suggestion
              </Button>
            </form>
          ) : null}
          {suggestionsQuery.isPending ? (
            <p className='text-xs text-muted-foreground'>
              Loading suggestions…
            </p>
          ) : suggestionsQuery.error ? (
            <p className='text-xs text-destructive'>
              Could not load suggestions.
            </p>
          ) : suggestionsQuery.data?.length ? (
            suggestionsQuery.data.map((suggestion) => (
              <div
                key={suggestion.suggestionId}
                className='flex items-start gap-3 rounded border bg-background p-2 text-xs'
              >
                <div className='min-w-0 flex-1'>
                  <p className='font-medium'>
                    {suggestion.summary || 'Suggestion'}
                  </p>
                  <p className='text-muted-foreground'>
                    {suggestion.status} · {suggestion.provenance}
                  </p>
                  {suggestion.reason ? <p>{suggestion.reason}</p> : null}
                  {conflictReviewMessage(
                    suggestion.status,
                    suggestion.conflictReason
                  ) ? (
                    <p className='mt-1 text-destructive'>
                      {conflictReviewMessage(
                        suggestion.status,
                        suggestion.conflictReason
                      )}
                    </p>
                  ) : null}
                </div>
                {canDecide && suggestion.status === 'pending' ? (
                  <div className='flex shrink-0 gap-1'>
                    <Button
                      size='sm'
                      disabled={decisionMutation.isPending}
                      onClick={() =>
                        decisionMutation.mutate({
                          suggestionID: suggestion.suggestionId,
                          decision: 'accept',
                        })
                      }
                    >
                      Accept
                    </Button>
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={decisionMutation.isPending}
                      onClick={() =>
                        decisionMutation.mutate({
                          suggestionID: suggestion.suggestionId,
                          decision: 'reject',
                        })
                      }
                    >
                      Reject
                    </Button>
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <p className='text-xs text-muted-foreground'>No suggestions.</p>
          )}
        </div>
      ) : null}
    </aside>
  )
}
