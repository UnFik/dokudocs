import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DocumentItem, DocumentRevision } from '@/types/dokudocs'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { useEditorPreferenceStore } from '@/stores/editor-preference-store'
import {
  createNamedDocumentRevision,
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
import { useCurrentProfile } from '@/features/auth/hooks/use-current-profile'
import { decodeBase64, encodeBase64 } from '../lib/collab-encoding'
import {
  clearLocalCopy,
  type CollabAccess,
  type CollabStatus,
  type PresenceUser,
} from '../lib/collab-session'
import { mountCollaborativeDocumentBody } from '../lib/collaborative-document-body'
import { countTasks } from '../lib/count-tasks'
import {
  documentBodyToMarkdown,
  type DocumentBodyNode,
} from '../lib/muya/state/documentBodyToMarkdown'
import { activeHeadingID, outlineOf, type OutlineItem } from '../lib/outline'
import type { EditorHistoryState } from '../lib/prosemirror/createDocumentBodyEditor'
import { EditorNotice } from '../lib/prosemirror/editorNotice'
import {
  emptyInlineState,
  type InlineMarkName,
  type InlineState,
} from '../lib/prosemirror/inlineMarks'
import { type SuggestionCard } from '../lib/prosemirror/suggestionCards'
import { shouldSelectDocumentBody } from '../lib/select-all-scope'
import { PublicShareDialog } from './dialogs/public-share-dialog'
import { DocumentInfoLine } from './document-info-line'
import { DocumentTitleRow } from './document-title-row'
import { HistoryButtons, SelectionToolbar } from './editor-format-toolbar'
import { EditorHeader } from './editor-header'
import {
  EditorModeTabs,
  modeTabStates,
  resolveMode,
  type EditorMode,
} from './editor-mode-tabs'
import './markdown-body.css'
import { OutlinePanel } from './outline-panel'
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
  // Bumped when the server replaces the body (a restored revision): the local
  // copy is dropped and the editor opens again on what the server holds.
  const [sessionNonce, setSessionNonce] = useState(0)
  const [access, setAccess] = useState<CollabAccess | null>(null)
  const queryClient = useQueryClient()
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
      await clearLocalCopy(workspaceID, document.id)
      setSessionNonce((value) => value + 1)
      await queryClient.invalidateQueries({
        queryKey: ['document-revisions', workspaceID, document.id],
      })
      toast.success('Revision restored')
    },
    onError: (error) => toast.error(error.message),
  })
  const [markdownOverride, setMarkdownOverride] = useState<string | null>(null)
  const markdown = markdownOverride ?? document.content
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
        titleReadOnly={offline || !access?.canEdit || accessUnavailable}
        onToggleHistory={
          offline ? undefined : () => setIsHistoryOpen((open) => !open)
        }
        onOpenShare={
          !offline && !document.isDraft && access?.canEdit && !accessUnavailable
            ? () => setIsShareOpen(true)
            : undefined
        }
        isHistoryOpen={isHistoryOpen}
        onExportCode={
          !accessUnavailable
            ? () => {
                void navigator.clipboard.writeText(markdown)
                toast.success('Document Markdown copied')
              }
            : undefined
        }
      />

      <CollaborativeMarkdownBody
        key={`${document.id}:${sessionNonce}`}
        documentID={document.id}
        workspaceID={workspaceID}
        userID={userID}
        offline={offline}
        access={access}
        focusNodeID={focusNodeID}
        title={document.title}
        titleReadOnly={offline || !access?.canEdit || accessUnavailable}
        onTitleChange={(title) => titleMutation.mutate(title)}
        meta={{
          updatedAt: document.updatedAt,
          updatedBy: document.updatedBy?.name ?? null,
          author: document.author.name,
          isDraft: Boolean(document.isDraft),
        }}
        markdown={markdown}
        onAccess={setAccess}
        onReloaded={() => {
          void clearLocalCopy(workspaceID, document.id).then(() =>
            setSessionNonce((value) => value + 1)
          )
        }}
        onMarkdownChange={setMarkdownOverride}
        onPresence={setPresence}
        onAccessUnavailable={() => {
          setAccessUnavailable(true)
          setMarkdownOverride('')
        }}
      />
      <VersionHistorySidebar
        docId={document.id}
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        revisions={offline ? [] : (revisionsQuery.data ?? [])}
        canEdit={access?.canEdit ?? false}
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
  access,
  focusNodeID,
  title,
  titleReadOnly,
  onTitleChange,
  meta,
  markdown,
  onAccess,
  onReloaded,
  onMarkdownChange,
  onPresence,
  onAccessUnavailable,
}: {
  documentID: string
  workspaceID: string
  userID: string
  offline: boolean
  access: CollabAccess | null
  focusNodeID?: string
  title: string
  titleReadOnly: boolean
  onTitleChange: (title: string) => void
  meta: {
    updatedAt: string
    updatedBy: string | null
    author: string
    isDraft: boolean
  }
  markdown: string
  onAccess: (access: CollabAccess) => void
  onReloaded: () => void
  onMarkdownChange: (markdown: string) => void
  onPresence: (users: PresenceUser[]) => void
  onAccessUnavailable: () => void
}) {
  const { name: profileName } = useCurrentProfile()
  const profileNameRef = useRef(profileName)
  useEffect(() => {
    profileNameRef.current = profileName
    sessionRef.current?.session.setUserName(profileName)
  }, [profileName])
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
  const smartText = useEditorPreferenceStore(
    (state) => state.preferencesByUser[userID || 'guest']?.smartText ?? false
  )
  const setSmartText = useEditorPreferenceStore((state) => state.setSmartText)
  const titleRef = useRef<HTMLInputElement>(null)
  const showOutline = useEditorPreferenceStore(
    (state) => state.preferencesByUser[userID || 'guest']?.showOutline ?? false
  )
  const setShowOutline = useEditorPreferenceStore(
    (state) => state.setShowOutline
  )
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [activeHeading, setActiveHeading] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // The heading being read follows the scroll position of the page.
  useEffect(() => {
    const container = scrollRef.current
    if (!container || !showOutline) return
    const update = () => {
      const top = container.getBoundingClientRect().top
      const positions = outline.flatMap((item) => {
        const heading = container.querySelector<HTMLElement>(
          `[data-node-id="${item.nodeID}"]`
        )
        return heading
          ? [
              {
                nodeID: item.nodeID,
                top: heading.getBoundingClientRect().top - top,
              },
            ]
          : []
      })
      setActiveHeading(activeHeadingID(positions, 80))
    }
    update()
    container.addEventListener('scroll', update, { passive: true })
    return () => container.removeEventListener('scroll', update)
  }, [outline, showOutline])
  const smartTextRef = useRef(smartText)
  useEffect(() => {
    smartTextRef.current = smartText
  })
  const [status, setStatus] = useState<CollabStatus>('connecting')
  const statusRef = useRef(status)
  const canEdit = access?.canEdit ?? false
  const canSuggest = access?.canSuggest ?? false
  const [error, setError] = useState('')
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
  // Our own comment changes are told to the others in the room.
  const fromRemoteComments = useRef(false)
  useEffect(() => {
    return queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type === 'updated' &&
        event.action.type === 'invalidate' &&
        event.query.queryKey[0] === 'document-comments' &&
        event.query.queryKey[2] === documentID &&
        !fromRemoteComments.current
      )
        sessionRef.current?.session.signalCommentsChanged()
    })
  }, [queryClient, documentID])
  const startCommentRef = useRef(startComment)
  useEffect(() => {
    startCommentRef.current = startComment
  })
  const [history, setHistory] = useState<EditorHistoryState>({
    canUndo: false,
    canRedo: false,
  })
  const [inline, setInline] = useState<InlineState>(emptyInlineState)
  const [linkRequest, setLinkRequest] = useState(0)
  const modeRef = useRef<EditorMode>(requestedMode)
  const lastEffectiveRef = useRef<EditorMode | null>(null)
  const canEditRef = useRef(canEdit)
  const canSuggestRef = useRef(canSuggest)
  useEffect(() => {
    canSuggestRef.current = canSuggest
  })
  useEffect(() => {
    canEditRef.current = canEdit
  })
  const suggestEnabled = canSuggest && !offline && status === 'ready'
  const mode = resolveMode(requestedMode, { canEdit, suggestEnabled })

  const applyEditorMode = () => {
    const editor = sessionRef.current?.editor
    if (!editor) return
    const effective = resolveMode(modeRef.current, {
      canEdit: canEditRef.current,
      suggestEnabled:
        canSuggestRef.current && !offline && statusRef.current === 'ready',
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
    sessionRef.current?.destroy()
    sessionRef.current = null
    mountRef.current?.replaceChildren()
    onMarkdownChange('')
    onAccessUnavailable()
    if (clearStoredData) void clearLocalCopy(workspaceID, documentID)
  }

  useMountEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let disposed = false

    void mountCollaborativeDocumentBody(mount, {
      documentID,
      workspaceID,
      userID,
      userName: profileNameRef.current,
      smartText: () => smartTextRef.current,
      onNavigateToTitle: () => titleRef.current?.focus(),
      onHeadingLink: (nodeID) => {
        const link = `${window.location.origin}${window.location.pathname}#node-${nodeID}`
        void navigator.clipboard
          .writeText(link)
          .then(() => toast.success('Link to heading copied'))
          .catch(() => toast.error('Could not copy the link'))
      },
      token: () => useAuthStore.getState().auth.accessToken,
      focusNodeID,
      readOnly:
        resolveMode(modeRef.current, {
          canEdit: canEditRef.current,
          suggestEnabled: false,
        }) === 'view',
      onSuggestRefused: (message) =>
        toast.error(message, { id: 'suggest-refused' }),
      onSuggestionCards: setCards,
      onCommentPositions: setCommentPositions,
      onCommentsChanged: () => {
        // A change that came from someone else must not be announced again.
        fromRemoteComments.current = true
        void queryClient.invalidateQueries({
          queryKey: ['document-comments', workspaceID, documentID],
        })
        fromRemoteComments.current = false
      },
      onReloaded,
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
      onAccess: (next) => {
        canEditRef.current = next.canEdit
        canSuggestRef.current = next.canSuggest
        onAccess(next)
        applyEditorMode()
      },
      onBodyChange: (nodes: DocumentBodyNode[]) => {
        setOutline(outlineOf(nodes))
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
        session.session.setUserName(profileNameRef.current)
        setSessionReady(true)
        setCards(session.editor.getSuggestionCards())
        onMarkdownChange(documentBodyToMarkdown(session.editor.getBody()))
        setOutline(outlineOf(session.editor.getBody()))
        applyEditorMode()
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

  const showSuggestionPanel =
    !offline && status !== 'forbidden' && status !== 'unauthorized'
  return (
    <section className='flex min-h-0 flex-1 flex-col'>
      <div className='flex flex-wrap items-center gap-2 border-b px-4 py-2'>
        <EditorModeTabs
          mode={mode}
          states={modeTabStates({
            canEdit,
            canSuggest: canSuggest,
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
          <Button
            size='sm'
            variant='ghost'
            className='h-11 md:h-8'
            aria-pressed={showOutline}
            onClick={() => setShowOutline(userID, !showOutline)}
          >
            Contents
          </Button>
          <Button
            size='sm'
            variant='ghost'
            className='h-11 md:h-8'
            aria-pressed={smartText}
            title='Curly quotes, arrows and an ellipsis as you type'
            onClick={() => setSmartText(userID, !smartText)}
          >
            Smart text
          </Button>
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
      <div className='flex min-h-0 flex-1 flex-col md:flex-row'>
        {showOutline ? (
          <OutlinePanel
            items={outline}
            activeID={activeHeading}
            onSelect={(nodeID) => {
              setActiveHeading(nodeID)
              const editor = sessionRef.current?.editor
              editor?.focusBlock(nodeID, 'start')
              scrollRef.current
                ?.querySelector(`[data-node-id="${nodeID}"]`)
                ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
            }}
          />
        ) : null}
        <div
          ref={scrollRef}
          className='markdown-body min-h-0 min-w-0 flex-1 overflow-auto p-6'
          data-suggestion-preview={suggestionPreview}
        >
          <DocumentTitleRow
            ref={titleRef}
            title={title}
            readOnly={titleReadOnly}
            onCommit={onTitleChange}
            onEnterBody={() => sessionRef.current?.editor.focusStart()}
          />
          <div className='mb-6'>
            <DocumentInfoLine
              updatedAt={meta.updatedAt}
              updatedBy={meta.updatedBy}
              author={meta.author}
              isDraft={meta.isDraft}
              tasks={countTasks(markdown)}
            />
          </div>
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
            canInteract={canEdit || canSuggest}
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
            canComment={canEdit || canSuggest}
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
    // The server learns of a new suggestion when it next stores the document.
    refetchInterval: (query) =>
      cards.some(
        (card) =>
          !query.state.data?.some(
            (discussion) => discussion.suggestionId === card.id
          )
      )
        ? 1500
        : false,
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
