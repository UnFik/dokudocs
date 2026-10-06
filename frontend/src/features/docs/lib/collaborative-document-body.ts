import { registerOpenDocument } from './collab-registry'
import {
  openCollabSession,
  type CollabAccess,
  type CollabStatus,
  type PresenceUser,
} from './collab-session'
import type { DocumentBodyNode } from './documentBody'
import { documentBodyToMarkdown } from './muya/state/documentBodyToMarkdown'
import { blockEditing } from './prosemirror/blocks'
import type { UploadedFile } from './prosemirror/blocks/uploads'
import type { MentionCandidate } from './prosemirror/blocks/triggerMenu'
import {
  createDocumentBodyEditor,
  type EditorHistoryState,
  type DocumentBodySelection,
} from './prosemirror/createDocumentBodyEditor'
import type { InlineState } from './prosemirror/inlineMarks'
import type { SuggestionCard } from './prosemirror/suggestionCards'

// How long a first open waits for the server before showing an empty body.
const firstSyncWaitMs = 4000

const accessKey = (room: string) => `dokudocs:access:${room}`

function cachedAccess(room: string): CollabAccess | null {
  try {
    const raw = window.localStorage.getItem(accessKey(room))
    return raw ? (JSON.parse(raw) as CollabAccess) : null
  } catch {
    return null
  }
}

function cacheAccess(room: string, access: CollabAccess) {
  try {
    window.localStorage.setItem(accessKey(room), JSON.stringify(access))
  } catch {
    // The cache only lets an offline reload keep its mode.
  }
}

export async function mountCollaborativeDocumentBody(
  mount: HTMLElement,
  input: {
    documentID: string
    workspaceID: string
    userID: string
    userName?: string
    token: string | (() => string)
    focusNodeID?: string
    url?: string
    readOnly?: boolean
    smartText?: () => boolean
    maxCharacters?: number
    resolveLinkTitle?: (href: string) => Promise<string | null>
    mentionSource?: (query: string) => Promise<MentionCandidate[]>
    upload?: (file: File) => Promise<UploadedFile>
    resolveAsset?: (src: string) => Promise<string>
    onUploadError?: (message: string) => void
    onHeadingLink?: (nodeID: string) => void
    onNavigateToTitle?: () => void
    onStatus?: (status: CollabStatus) => void
    onAccess?: (access: CollabAccess) => void
    onPresence?: (users: PresenceUser[]) => void
    onBodyChange?: (body: DocumentBodyNode[]) => void
    onTransactionError?: (error: unknown) => void
    onHistoryChange?: (history: EditorHistoryState) => void
    onInlineStateChange?: (state: InlineState) => void
    onLinkRequest?: () => void
    onSuggestRefused?: (message: string) => void
    onSuggestionCards?: (cards: SuggestionCard[]) => void
    onSuggestionClick?: (id: string) => void
    onCommentsChanged?: () => void
    onReloaded?: () => void
    onCommentPositions?: (positions: Record<string, number | null>) => void
    onCommentClick?: (id: string) => void
    onCommentRequest?: () => void
  }
) {
  const room = `${input.workspaceID}.${input.documentID}`
  const forceReadOnly = input.readOnly ?? false
  const known = cachedAccess(room)
  // Until the server says what this person may do, the body is read-only.
  let access: CollabAccess = known ?? { canEdit: false, canSuggest: false }
  let setReadOnly = (_readOnly: boolean) => {}
  let showCursors: Parameters<
    typeof openCollabSession
  >[0]['onCursors'] = () => {}
  const session = openCollabSession({
    workspaceID: input.workspaceID,
    documentID: input.documentID,
    userID: input.userID,
    userName: input.userName,
    token: input.token,
    url: input.url,
    onStatus: (status) => {
      if (status === 'unauthorized' || status === 'forbidden') setReadOnly(true)
      input.onStatus?.(status)
    },
    onAccess: (next) => {
      access = next
      cacheAccess(room, next)
      setReadOnly(forceReadOnly || !next.canEdit)
      input.onAccess?.(next)
    },
    onPresence: input.onPresence,
    onCursors: (cursors) => showCursors?.(cursors),
    onCommentsChanged: input.onCommentsChanged,
    onReloaded: input.onReloaded,
  })
  let editorDestroyed = false
  let destroyEditor = () => {}
  try {
    await session.loaded
    // A body that is empty here may only be empty because the server has not
    // answered yet: wait, or the editor would add a paragraph of its own.
    if (session.ydoc.getXmlFragment('body').length === 0)
      await Promise.race([
        session.synced,
        new Promise((resolve) => setTimeout(resolve, firstSyncWaitMs)),
      ])
    if (known) input.onAccess?.(known)

    const blocks = blockEditing({
      upload: input.upload,
      resolveSource: input.resolveAsset,
      onUploadError: input.onUploadError,
    })
    const editor = createDocumentBodyEditor(mount, session.ydoc, {
      readOnly: forceReadOnly || !access.canEdit,
      smartText: input.smartText,
      maxCharacters: input.maxCharacters,
      resolveLinkTitle: input.resolveLinkTitle,
      mentionSource: input.mentionSource,
      onHeadingLink: input.onHeadingLink,
      onNavigateToTitle: input.onNavigateToTitle,
      plugins: blocks.plugins,
      nodeViews: blocks.nodeViews,
      onEditorReady: blocks.attach,
      onBodyChange: input.onBodyChange,
      onTransactionError: input.onTransactionError,
      onHistoryChange: input.onHistoryChange,
      onInlineStateChange: input.onInlineStateChange,
      onLinkRequest: input.onLinkRequest,
      suggestAuthor: input.userID,
      onSuggestRefused: input.onSuggestRefused,
      onSuggestionCards: input.onSuggestionCards,
      onSuggestionClick: input.onSuggestionClick,
      onCommentPositions: input.onCommentPositions,
      onCommentClick: input.onCommentClick,
      onCommentRequest: input.onCommentRequest,
      onSelectionChange: (selection: DocumentBodySelection | null) =>
        session.setCursor(selection),
    })
    showCursors = (cursors) => editor.setRemoteCursors(cursors)
    setReadOnly = (readOnly) => editor.setReadOnly(readOnly)
    const hashTarget = window.location.hash.startsWith('#node-')
      ? window.location.hash.slice('#node-'.length)
      : undefined
    const focusNodeID = input.focusNodeID ?? hashTarget
    if (focusNodeID) {
      requestAnimationFrame(() => {
        const target = Array.from(
          mount.querySelectorAll<HTMLElement>('[data-node-id]')
        ).find((node) => node.dataset.nodeId === focusNodeID)
        target?.scrollIntoView?.({ block: 'center' })
      })
    }
    let destroyed = false
    const unregister = registerOpenDocument({
      userID: input.userID,
      documentID: input.documentID,
      workspaceID: input.workspaceID,
      unsyncedChanges: session.unsyncedChanges,
      drained: session.drained,
      markdown: () => documentBodyToMarkdown(editor.getBody()),
      destroy: () => api.destroy(),
    })
    destroyEditor = () => {
      if (editorDestroyed) return
      editorDestroyed = true
      editor.destroy()
    }
    const api = {
      document: session.ydoc,
      editor,
      session,
      destroy() {
        if (destroyed) return
        destroyed = true
        unregister()
        destroyEditor()
        session.destroy()
      },
    }
    return api
  } catch (error) {
    destroyEditor()
    session.destroy()
    throw error
  }
}
