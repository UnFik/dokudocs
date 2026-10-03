import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DocumentItem, DocumentRevision } from '@/types/dokudocs'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { useEditorPreferenceStore } from '@/stores/editor-preference-store'
import { ApiError } from '@/lib/api-client'
import {
  createNamedDocumentRevision,
  getMarkdownBody,
  listDocumentSuggestions,
  listDocumentRevisions,
  restoreDocumentRevision,
  updateDocumentMetadata,
  listDocumentComments,
  type CommentAnchor,
  type CommentThread,
} from '@/lib/domain-api'
import { useMountEffect } from '@/hooks/use-mount-effect'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  executeDeleteNode,
  executeMoveNode,
  type CollaborativeDocumentStatus,
} from '../lib/collaboration-provider'
import {
  clearLocalMarkdown,
  loadOfflineMarkdownBody,
  recoverPendingMarkdown,
} from '../lib/collaboration-recovery'
import {
  acceptHeldEdit,
  loadReviewModel,
  resolveHeldCommand,
} from '../lib/collaboration-review'
import {
  decodeBase64,
  encodeBase64,
  type PresenceUser,
} from '../lib/collaboration-socket'
import {
  IndexedDBCollaborationStore,
  type PendingCollaborationUpdate,
  type PendingDeleteNodeCommand,
  type PendingMoveNodeCommand,
} from '../lib/collaboration-store'
import { mountCollaborativeDocumentBody } from '../lib/collaborative-document-body'
import {
  documentBodyToMarkdown,
  type DocumentBodyNode,
} from '../lib/muya/state/documentBodyToMarkdown'
import type { EditorHistoryState } from '../lib/prosemirror/createDocumentBodyEditor'
import { EditorNotice } from '../lib/prosemirror/editorNotice'
import {
  emptyInlineState,
  type InlineMarkName,
  type InlineState,
} from '../lib/prosemirror/inlineMarks'
import { type SuggestionCard } from '../lib/prosemirror/suggestionCards'
import { shouldSelectDocumentBody } from '../lib/select-all-scope'
import { ConflictReviewPanel } from './conflict-review-panel'
import { PublicShareDialog } from './dialogs/public-share-dialog'
import { HistoryButtons, SelectionToolbar } from './editor-format-toolbar'
import { EditorHeader } from './editor-header'
import {
  EditorModeTabs,
  modeTabStates,
  resolveMode,
  type EditorMode,
} from './editor-mode-tabs'
import './markdown-body.css'
import { MuyaEditor } from './muya-editor/MuyaEditor'
import { SuggestionCardList } from './suggestion-card-list'
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
  const [localStateNonce, setLocalStateNonce] = useState(0)
  // A delete merged into the live document moves the body to a new epoch without
  // rebuilding the editor. The editor is rebuilt for any other change of body,
  // so what the page mounted is tracked as a generation of its own.
  const [advanced, setAdvanced] = useState<{
    epoch: number
    version: number
  } | null>(null)
  const [mounted, setMounted] = useState({ stamp: '', generation: 0 })
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
  if (bodyQuery.data) {
    const stamp = `${bodyQuery.data.bodyEpoch}:${bodyQuery.data.bodyVersion}`
    if (mounted.stamp !== stamp) {
      const followsAdvance =
        advanced !== null &&
        bodyQuery.data.bodyEpoch === advanced.epoch &&
        bodyQuery.data.bodyVersion >= advanced.version
      setMounted({
        stamp,
        generation: followsAdvance
          ? mounted.generation
          : mounted.generation + 1,
      })
    }
  }
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
  const [presence, setPresence] = useState<PresenceUser[]>([])
  const restoreRevision = (revision: DocumentRevision) => {
    if (
      !window.confirm(
        'Restore this revision? Any suggestions still pending are discarded.'
      )
    )
      return
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
        presenceUsers={presence}
        currentUserID={userID}
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
          key={`${document.id}:${mounted.generation}:${localStateNonce}`}
          documentID={document.id}
          workspaceID={workspaceID}
          userID={userID}
          offline={offline}
          snapshot={bodyQuery.data}
          focusNodeID={focusNodeID}
          onLocalStateChanged={() => setLocalStateNonce((value) => value + 1)}
          onCanonicalBody={(body) => {
            queryClient.setQueryData(
              ['markdown-body', workspaceID, document.id, userID, offline],
              body
            )
            // A rebase at startup lands on the body this page already loaded,
            // so the key alone would not remount onto the rebased state.
            setLocalStateNonce((value) => value + 1)
          }}
          onBodyAdvanced={(body) => {
            queryClient.setQueryData(
              ['markdown-body', workspaceID, document.id, userID, offline],
              body
            )
            setAdvanced({ epoch: body.bodyEpoch, version: body.bodyVersion })
          }}
          onMarkdownChange={setMarkdownOverride}
          onPresence={setPresence}
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
  onBodyAdvanced,
  onLocalStateChanged,
  onMarkdownChange,
  onPresence,
  onAccessUnavailable,
}: {
  documentID: string
  workspaceID: string
  userID: string
  offline: boolean
  snapshot: Awaited<ReturnType<typeof getMarkdownBody>>
  focusNodeID?: string
  onCanonicalBody: (body: Awaited<ReturnType<typeof getMarkdownBody>>) => void
  onBodyAdvanced: (body: Awaited<ReturnType<typeof getMarkdownBody>>) => void
  onLocalStateChanged: () => void
  onMarkdownChange: (markdown: string) => void
  onPresence: (users: PresenceUser[]) => void
  onAccessUnavailable: () => void
}) {
  const [suggestionPreview, setSuggestionPreview] = useState<
    'suggestions' | 'accepted' | 'rejected'
  >('suggestions')
  const suggestionPreviewRef = useRef(suggestionPreview)
  const mountRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<Awaited<
    ReturnType<typeof mountCollaborativeDocumentBody>
  > | null>(null)
  const storedMode = useEditorPreferenceStore(
    (state) => state.preferencesByUser[userID || 'guest']?.previewMode ?? 'edit'
  )
  // The stored mode is the user's choice. When it cannot be used right now
  // (offline, no suggest access) the editor shows a fallback and leaves the
  // stored value alone, so Suggest returns once it is possible again.
  const requestedMode: EditorMode = storedMode
  const setPreviewMode = useEditorPreferenceStore(
    (state) => state.setPreviewMode
  )
  const [status, setStatus] =
    useState<CollaborativeDocumentStatus>('connecting')
  const statusRef = useRef(status)
  const [canEdit, setCanEdit] = useState(snapshot.canEdit)
  const [error, setError] = useState('')
  const [recoveryPendingCount, setRecoveryPendingCount] = useState(0)
  const [, setIsExportingRecovery] = useState(false)
  const [hasHeldEdits, setHasHeldEdits] = useState(false)
  const [reviewKey, setReviewKey] = useState(0)
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false)
  const [cards, setCards] = useState<SuggestionCard[]>([])
  const [focusedSuggestionID, setFocusedSuggestionID] = useState<string | null>(
    null
  )
  const [commentPositions, setCommentPositions] = useState<
    Record<string, number | null>
  >({})
  const [focusedCommentID, setFocusedCommentID] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState<{
    selectedText: string
    anchor: CommentAnchor
  } | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const queryClient = useQueryClient()
  const commentsQuery = useQuery({
    queryKey: ['document-comments', workspaceID, documentID],
    queryFn: ({ signal }) =>
      listDocumentComments(workspaceID, documentID, signal),
    retry: false,
    refetchOnWindowFocus: true,
  })
  const comments = useMemo(() => commentsQuery.data ?? [], [commentsQuery.data])
  // The editor marks and places every thread; it needs the threads and a session.
  useEffect(() => {
    if (!sessionReady) return
    sessionRef.current?.editor.setComments(
      comments.map((thread) => ({
        id: thread.id,
        resolved: Boolean(thread.resolvedAt),
        anchor: thread.anchor
          ? {
              nodeID: thread.anchor.nodeID,
              start: decodeBase64(thread.anchor.start),
              end: decodeBase64(thread.anchor.end),
            }
          : null,
      }))
    )
  }, [comments, sessionReady])
  const startComment = () => {
    const editor = sessionRef.current?.editor
    if (!editor) return
    const draft = editor.getCommentDraft()
    if (!draft.ok) {
      toast.error(draft.message, { id: 'comment-draft' })
      return
    }
    setCommentDraft({
      selectedText: draft.selectedText,
      anchor: {
        nodeID: draft.anchor.nodeID,
        start: encodeBase64(draft.anchor.start),
        end: encodeBase64(draft.anchor.end),
      },
    })
    setIsSuggestionsOpen(true)
  }
  const startCommentRef = useRef(startComment)
  useEffect(() => {
    startCommentRef.current = startComment
  })
  const reviewStore = useMemo(() => new IndexedDBCollaborationStore(), [])
  const [history, setHistory] = useState<EditorHistoryState>({
    canUndo: false,
    canRedo: false,
  })
  const [inline, setInline] = useState<InlineState>(emptyInlineState)
  const [linkRequest, setLinkRequest] = useState(0)
  const modeRef = useRef<EditorMode>(requestedMode)
  const lastEffectiveRef = useRef<EditorMode | null>(null)
  const canEditRef = useRef(canEdit)
  const suggestEnabled =
    Boolean(snapshot.canSuggest) && !offline && status === 'ready'
  const mode = resolveMode(requestedMode, { canEdit, suggestEnabled })

  const applyEditorMode = () => {
    const editor = sessionRef.current?.editor
    if (!editor) return
    // The collaboration session locks the editor itself in these states.
    if (
      statusRef.current === 'closed' ||
      statusRef.current === 'recovery-required'
    )
      return
    const effective = resolveMode(modeRef.current, {
      canEdit: canEditRef.current,
      suggestEnabled:
        Boolean(snapshot.canSuggest) &&
        !offline &&
        statusRef.current === 'ready',
    })
    editor.setSuggestMode(effective === 'suggest')
    editor.setReadOnly(
      effective === 'view' || suggestionPreviewRef.current !== 'suggestions'
    )
    if (effective === 'suggest' && lastEffectiveRef.current !== 'suggest')
      setIsSuggestionsOpen(true)
    lastEffectiveRef.current = effective
  }

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

    void new IndexedDBCollaborationStore()
      .load({ userID, documentID })
      .then((stored) => {
        if (!disposed && stored.heldEdits.length) setHasHeldEdits(true)
      })
      .catch(() => {})

    void mountCollaborativeDocumentBody(mount, {
      documentID,
      workspaceID,
      userID,
      token: () => useAuthStore.getState().auth.accessToken,
      snapshot,
      focusNodeID,
      readOnly:
        resolveMode(modeRef.current, {
          canEdit: snapshot.canEdit,
          suggestEnabled: false,
        }) === 'view',
      onSuggestRefused: (message) =>
        toast.error(message, { id: 'suggest-refused' }),
      onSuggestionCards: setCards,
      onCommentPositions: setCommentPositions,
      onCommentsChanged: () =>
        void queryClient.invalidateQueries({
          queryKey: ['document-comments', workspaceID, documentID],
        }),
      onCommentRequest: () => startCommentRef.current(),
      onCommentClick: (id) => {
        setFocusedCommentID(id)
        setFocusedSuggestionID(null)
        setIsSuggestionsOpen(true)
        requestAnimationFrame(() => {
          const card = [
            ...(window.document
              .getElementById('suggestion-panel')
              ?.querySelectorAll<HTMLElement>('li[data-comment-thread-id]') ??
              []),
          ].find((element) => element.dataset.commentThreadId === id)
          card?.scrollIntoView({ block: 'nearest' })
        })
      },
      onSuggestionClick: (id) => {
        setFocusedSuggestionID(id)
        const card = [
          ...(window.document
            .getElementById('suggestion-panel')
            ?.querySelectorAll<HTMLElement>('li[data-suggestion-id]') ?? []),
        ].find((element) => element.dataset.suggestionId === id)
        card?.scrollIntoView({ block: 'nearest' })
      },
      onStatus: (next) => {
        statusRef.current = next
        setStatus(next)
        if (next === 'forbidden') {
          hideBodyAfterAccessLoss(true)
          setError('Read access is no longer available.')
        } else if (next === 'unauthorized') {
          hideBodyAfterAccessLoss(false)
          setError('Sign in again to load this document.')
        } else {
          applyEditorMode()
        }
      },
      onPresence,
      onCanEdit: (next) => {
        canEditRef.current = next
        setCanEdit(next)
        applyEditorMode()
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
      onBodyAdvanced,
      // eslint-disable-next-line no-console
      onEditDropped: (code) => console.warn('edit dropped by the server', code),
      onHeldEdits: () => setHasHeldEdits(true),
      onBodyChange: (nodes: DocumentBodyNode[]) => {
        try {
          onMarkdownChange(documentBodyToMarkdown(nodes))
        } catch (cause) {
          setError(
            cause instanceof Error ? cause.message : 'Could not export Markdown'
          )
        }
      },
      // Only messages written for the person editing are shown; anything else
      // the editor raises is internal and goes to the log.
      onTransactionError: (cause) => {
        if (cause instanceof EditorNotice) setError(cause.message)
        // eslint-disable-next-line no-console
        else console.error('editor error', cause)
      },
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
        setSessionReady(true)
        setCards(session.editor.getSuggestionCards())
        onMarkdownChange(documentBodyToMarkdown(session.editor.getBody()))
        applyEditorMode()
        if (
          statusRef.current === 'closed' ||
          statusRef.current === 'recovery-required'
        )
          session.editor.setReadOnly(true)
      })
      .catch((cause) => {
        if (!disposed)
          setError(
            cause instanceof Error ? cause.message : 'Collaboration failed'
          )
      })

    // Select all selects the document body, not every word on the page.
    const selectDocumentBody = (event: KeyboardEvent) => {
      if (!shouldSelectDocumentBody(event, mount)) return
      const editor = sessionRef.current?.editor
      if (!editor) return
      event.preventDefault()
      editor.selectAll()
    }
    window.addEventListener('keydown', selectDocumentBody)

    return () => {
      disposed = true
      window.removeEventListener('keydown', selectDocumentBody)
      sessionRef.current?.destroy()
      sessionRef.current = null
    }
  })

  const changeMode = (next: EditorMode) => {
    modeRef.current = next
    setPreviewMode(userID, next)
    applyEditorMode()
  }

  const changeSuggestionPreview = (
    next: 'suggestions' | 'accepted' | 'rejected'
  ) => {
    suggestionPreviewRef.current = next
    setSuggestionPreview(next)
    if (next === 'suggestions') applyEditorMode()
    else sessionRef.current?.editor.setReadOnly(true)
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

  const showSuggestionPanel =
    !offline && status !== 'forbidden' && status !== 'unauthorized'
  return (
    <section className='flex min-h-0 flex-1 flex-col'>
      <div className='flex flex-wrap items-center gap-2 border-b px-4 py-2'>
        <EditorModeTabs
          mode={mode}
          states={modeTabStates({
            canEdit,
            canSuggest: Boolean(snapshot.canSuggest),
            online: !offline,
            synced: status === 'ready',
          })}
          onChange={changeMode}
        />
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
          {showSuggestionPanel ? (
            <Button
              size='sm'
              variant='outline'
              className='h-11 md:h-8'
              aria-expanded={isSuggestionsOpen}
              aria-controls='suggestion-panel'
              onClick={() => setIsSuggestionsOpen((open) => !open)}
            >
              Review
            </Button>
          ) : null}
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
      {(status === 'recovery-required' && recoveryPendingCount > 0) ||
      hasHeldEdits ? (
        <ConflictReviewPanel
          key={reviewKey}
          load={() =>
            loadReviewModel({
              scope: { userID, documentID },
              includePendingDiff: statusRef.current === 'recovery-required',
              store: reviewStore,
              fetchBody: () => getMarkdownBody(workspaceID, documentID),
            })
          }
          actions={{
            copyText: (text) => navigator.clipboard.writeText(text),
            acceptHeld: async (nodeID) => {
              await acceptHeldEdit({
                scope: { userID, documentID },
                store: reviewStore,
                nodeID,
                fetchBody: () => getMarkdownBody(workspaceID, documentID),
              })
              onLocalStateChanged()
            },
            exportLocal: exportPendingChanges,
            dismissHeld: async () => {
              await reviewStore.clearHeldEdits({ userID, documentID })
              setHasHeldEdits(false)
            },
            discardLocal: async () => {
              const body = await getMarkdownBody(workspaceID, documentID)
              await clearLocalMarkdown({ userID, documentID })
              setHasHeldEdits(false)
              setRecoveryPendingCount(0)
              setError('')
              onCanonicalBody(body)
            },
            resolveCommand: async (kind, commandID, choice) => {
              const body = await resolveHeldCommand({
                scope: { userID, documentID },
                store: reviewStore,
                kind,
                commandID,
                choice,
                fetchBody: () => getMarkdownBody(workspaceID, documentID),
                executeDelete: (command) =>
                  executeDeleteNode(workspaceID, documentID, command),
                executeMove: (command) =>
                  executeMoveNode(workspaceID, documentID, command),
              })
              setReviewKey((value) => value + 1)
              onCanonicalBody(body)
            },
          }}
        />
      ) : null}
      <div className='flex min-h-0 flex-1 flex-col md:flex-row'>
        <div
          className='markdown-body min-h-0 min-w-0 flex-1 overflow-auto p-6'
          data-suggestion-preview={suggestionPreview}
        >
          <div ref={mountRef} />
        </div>
        {(mode === 'edit' && canEdit) || mode === 'suggest' ? (
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
        {showSuggestionPanel ? (
          <SuggestionPanel
            open={isSuggestionsOpen}
            workspaceID={workspaceID}
            documentID={documentID}
            userID={userID}
            canDecide={canEdit}
            canInteract={canEdit || Boolean(snapshot.canSuggest)}
            cards={cards}
            decisionsDisabled={
              mode === 'view' || suggestionPreview !== 'suggestions'
            }
            preview={suggestionPreview}
            onPreviewChange={changeSuggestionPreview}
            focusedSuggestionID={focusedSuggestionID}
            comments={comments}
            commentPositions={commentPositions}
            focusedCommentID={focusedCommentID}
            newComment={commentDraft}
            canComment={canEdit || Boolean(snapshot.canSuggest)}
            commentsFailed={Boolean(commentsQuery.error)}
            commentsLoading={commentsQuery.isPending}
            onStartComment={startComment}
            onNewCommentDone={() => setCommentDraft(null)}
            onSelectComment={(id) => {
              setFocusedCommentID(id)
              setFocusedSuggestionID(null)
              sessionRef.current?.editor.scrollToComment(id)
            }}
            onSelect={(id) => {
              setFocusedSuggestionID(id)
              setFocusedCommentID(null)
              sessionRef.current?.editor.setFocusedComment(null)
              sessionRef.current?.editor.scrollToSuggestion(id)
            }}
            onDecide={(id, decision) =>
              sessionRef.current?.editor.decide(id, decision)
            }
          />
        ) : null}
      </div>
    </section>
  )
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
  workspaceID,
  documentID,
  userID,
  canDecide,
  canInteract,
  cards,
  decisionsDisabled,
  preview,
  onPreviewChange,
  focusedSuggestionID,
  onSelect,
  onDecide,
  comments,
  commentPositions,
  focusedCommentID,
  newComment,
  canComment,
  commentsFailed,
  commentsLoading,
  onStartComment,
  onNewCommentDone,
  onSelectComment,
}: {
  open: boolean
  workspaceID: string
  documentID: string
  userID: string
  canDecide: boolean
  canInteract: boolean
  cards: SuggestionCard[]
  decisionsDisabled: boolean
  preview: 'suggestions' | 'accepted' | 'rejected'
  onPreviewChange: (preview: 'suggestions' | 'accepted' | 'rejected') => void
  focusedSuggestionID: string | null
  onSelect: (id: string) => void
  onDecide: (id: string, decision: 'accept' | 'reject') => void
  comments: CommentThread[]
  commentPositions: Record<string, number | null>
  focusedCommentID: string | null
  newComment: { selectedText: string; anchor: CommentAnchor } | null
  canComment: boolean
  commentsFailed: boolean
  commentsLoading: boolean
  onStartComment: () => void
  onNewCommentDone: () => void
  onSelectComment: (id: string) => void
}) {
  const [bulkDecision, setBulkDecision] = useState<'accept' | 'reject' | null>(
    null
  )
  const suggestionsQuery = useQuery({
    queryKey: [
      'document-suggestions',
      workspaceID,
      documentID,
      cards.map((card) => card.id),
    ],
    queryFn: ({ signal }) =>
      listDocumentSuggestions(workspaceID, documentID, signal),
    enabled: true,
    retry: false,
  })
  return (
    <>
      {open ? (
        <aside
          id='suggestion-panel'
          aria-label='Review'
          className='max-h-[40vh] min-w-0 shrink-0 overflow-auto border-t bg-card md:max-h-none md:w-80 md:border-t-0 md:border-l'
        >
          {canComment ? (
            <div className='flex justify-end px-4 pt-3'>
              <Button
                size='sm'
                variant='outline'
                // Keep the text selected: a click would otherwise clear it.
                onMouseDown={(event) => event.preventDefault()}
                onClick={onStartComment}
              >
                Comment
              </Button>
            </div>
          ) : null}
          {cards.length ? (
            <div className='flex flex-wrap items-center justify-between gap-2 px-4 pt-3'>
              <div
                role='group'
                aria-label='Suggestion preview'
                className='flex rounded-md border p-0.5'
              >
                {(
                  [
                    ['suggestions', 'Show', 'Show suggestions'],
                    ['accepted', 'Accepted', 'Preview accepted'],
                    ['rejected', 'Rejected', 'Preview rejected'],
                  ] as const
                ).map(([value, label, accessibleName]) => (
                  <Button
                    key={value}
                    size='sm'
                    variant={preview === value ? 'secondary' : 'ghost'}
                    className='h-7 px-2 text-xs'
                    aria-label={accessibleName}
                    aria-pressed={preview === value}
                    onClick={() => onPreviewChange(value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          {canDecide && cards.length ? (
            <div className='flex justify-end gap-2 px-4 pt-2'>
              <Button
                size='sm'
                variant='outline'
                disabled={decisionsDisabled}
                onClick={() => setBulkDecision('reject')}
              >
                Reject all
              </Button>
              <Button
                size='sm'
                disabled={decisionsDisabled}
                onClick={() => setBulkDecision('accept')}
              >
                Accept all
              </Button>
            </div>
          ) : null}
          <SuggestionCardList
            cards={cards}
            userID={userID}
            canDecide={canDecide}
            disabled={decisionsDisabled}
            onDecide={onDecide}
            onSelect={onSelect}
            focusedSuggestionID={focusedSuggestionID}
            discussions={suggestionsQuery.data ?? []}
            canInteract={canInteract}
            workspaceID={workspaceID}
            documentID={documentID}
            comments={comments}
            commentPositions={commentPositions}
            focusedCommentID={focusedCommentID}
            onSelectComment={onSelectComment}
            newComment={newComment}
            onNewCommentDone={onNewCommentDone}
            commentsLoading={commentsLoading}
          />
          {commentsFailed ? (
            <p className='px-4 pb-3 text-xs text-destructive'>
              Could not load comments. They will load again when this window
              regains focus.
            </p>
          ) : null}
          {suggestionsQuery.error ? (
            <p className='px-4 pb-3 text-xs text-destructive'>
              Could not load suggestion discussions.
            </p>
          ) : null}
          <ConfirmDialog
            open={bulkDecision !== null}
            onOpenChange={(open) => {
              if (!open) setBulkDecision(null)
            }}
            title={`${bulkDecision === 'accept' ? 'Accept' : 'Reject'} all ${cards.length} ${cards.length === 1 ? 'suggestion' : 'suggestions'}?`}
            desc={`This will ${bulkDecision ?? 'decide'} ${cards.length} ${cards.length === 1 ? 'suggestion' : 'suggestions'} in the document.`}
            confirmText={`${bulkDecision === 'accept' ? 'Accept' : 'Reject'} all`}
            destructive={bulkDecision === 'reject'}
            handleConfirm={() => {
              if (!bulkDecision) return
              for (const card of cards) onDecide(card.id, bulkDecision)
              setBulkDecision(null)
            }}
          />
        </aside>
      ) : null}
    </>
  )
}
