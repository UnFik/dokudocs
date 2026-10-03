import * as Y from 'yjs'
import type { MarkdownBodySnapshot } from '@/lib/domain-api'
import {
  CollaborativeDocumentProvider,
  type CollaborativeDocumentStatus,
  type RecoveryReason,
} from './collaboration-provider'
import type { HeldEdit } from './collaboration-rebase'
import {
  decodeBase64,
  type CollaborationSocketOptions,
  type PresenceUser,
  type RemoteCursor,
} from './collaboration-socket'
import {
  IndexedDBCollaborationStore,
  type CollaborationStore,
  type PendingDeleteNodeCommand,
  type PendingMoveNodeCommand,
  type PendingCollaborationUpdate,
} from './collaboration-store'
import type { DocumentBodyNode } from './documentBody'
import { blockEditing } from './prosemirror/blocks'
import {
  createDocumentBodyEditor,
  type EditorHistoryState,
  type DocumentBodySelection,
  type MoveNodeIntent,
} from './prosemirror/createDocumentBodyEditor'
import type { CaretHint } from './prosemirror/deleteTargets'
import type { InlineState } from './prosemirror/inlineMarks'
import type { SuggestionCard } from './prosemirror/suggestionCards'

// A delete rebuilds the editor, so the place the caret should return to is kept
// here, outside it, until the next editor for the same document asks.
const caretHints = new Map<string, CaretHint>()

type CollaborativeBodySnapshot = {
  bodyVersion: number
  bodyEpoch: number
  compatEpoch?: number
  bodySchemaVersion: number
  canEdit: boolean
  canSuggest?: boolean
  encodedState: string
}

export async function mountCollaborativeDocumentBody(
  mount: HTMLElement,
  input: {
    documentID: string
    workspaceID: string
    userID: string
    token: string | (() => string)
    snapshot: CollaborativeBodySnapshot
    focusNodeID?: string
    store?: CollaborationStore
    executeDeleteNode?: (
      command: PendingDeleteNodeCommand
    ) => Promise<MarkdownBodySnapshot>
    executeMoveNode?: (
      command: PendingMoveNodeCommand
    ) => Promise<MarkdownBodySnapshot>
    socketFactory?: CollaborationSocketOptions['socketFactory']
    baseURL?: string
    readOnly?: boolean
    onStatus?: (status: CollaborativeDocumentStatus) => void
    onCanEdit?: (canEdit: boolean) => void
    onPresence?: (users: PresenceUser[]) => void
    onRecovery?: (
      reason: RecoveryReason,
      pending: PendingCollaborationUpdate[],
      deleteCommands: PendingDeleteNodeCommand[],
      moveCommands: PendingMoveNodeCommand[]
    ) => void
    onBodyAdvanced?: (body: MarkdownBodySnapshot) => void
    onEditDropped?: (code: string) => void
    onCanonicalBody?: (body: MarkdownBodySnapshot) => void
    onHeldEdits?: (edits: HeldEdit[]) => void
    onBodyChange?: (body: DocumentBodyNode[]) => void
    onDeleteNodeQueued?: (nodeID: string) => void
    onMoveNodeQueued?: (move: MoveNodeIntent) => void
    onTransactionError?: (error: unknown) => void
    onHistoryChange?: (history: EditorHistoryState) => void
    onInlineStateChange?: (state: InlineState) => void
    onLinkRequest?: () => void
    onSuggestRefused?: (message: string) => void
    onSuggestionCards?: (cards: SuggestionCard[]) => void
    onSuggestionClick?: (id: string) => void
    onCommentsChanged?: () => void
    onCommentPositions?: (positions: Record<string, number | null>) => void
    onCommentClick?: (id: string) => void
    onCommentRequest?: () => void
  }
) {
  const document = new Y.Doc()
  let provider: CollaborativeDocumentProvider | undefined
  const forceReadOnly = input.readOnly ?? false
  let editorReadOnly = forceReadOnly || !input.snapshot.canEdit
  let setEditorReadOnly = (readOnly: boolean) => {
    editorReadOnly = readOnly
  }
  let destroyEditor = () => {}
  let showRemoteCursors: (cursors: RemoteCursor[]) => void = () => {}
  let finishStructural = () => {}
  const cursorSender = createCursorSender((selection) =>
    provider?.sendCursor(selection)
  )
  let bodyDestroyed = false
  const destroyBody = () => {
    if (bodyDestroyed) return
    bodyDestroyed = true
    document.destroy()
  }
  try {
    Y.applyUpdate(document, decodeBase64(input.snapshot.encodedState))
    const status: { current: CollaborativeDocumentStatus } = {
      current: 'connecting',
    }
    provider = new CollaborativeDocumentProvider({
      documentID: input.documentID,
      workspaceID: input.workspaceID,
      userID: input.userID,
      token: input.token,
      document,
      bodyVersion: input.snapshot.bodyVersion,
      bodyEpoch: input.snapshot.bodyEpoch,
      compatEpoch: input.snapshot.compatEpoch,
      bodySchemaVersion: input.snapshot.bodySchemaVersion,
      canEdit: input.snapshot.canEdit,
      canSuggest: input.snapshot.canSuggest,
      store: input.store ?? new IndexedDBCollaborationStore(),
      executeDeleteNode: input.executeDeleteNode,
      executeMoveNode: input.executeMoveNode,
      socketFactory: input.socketFactory,
      baseURL: input.baseURL,
      onStatus: (next) => {
        status.current = next
        if (
          next === 'storage-error' ||
          next === 'recovery-required' ||
          next === 'unauthorized' ||
          next === 'forbidden'
        )
          setEditorReadOnly(true)
        if (next === 'forbidden') {
          destroyEditor()
          mount.replaceChildren()
          destroyBody()
        }
        input.onStatus?.(next)
      },
      onRecovery: input.onRecovery,
      onPresence: input.onPresence,
      onRemoteCursors: (cursors) => showRemoteCursors(cursors),
      onCommentsChanged: input.onCommentsChanged,
      onCanonicalBody: input.onCanonicalBody,
      onBodyAdvanced: (body) => {
        finishStructural()
        input.onBodyAdvanced?.(body)
      },
      onEditDropped: input.onEditDropped,
      onHeldEdits: input.onHeldEdits,
      onCanEdit: (canEdit) => {
        // A caller that handles onCanEdit owns the mode, whether or not it asked
        // for a read-only editor to start with. Setting read-only here first
        // would flip the editor off and on again on every resync, and a
        // contenteditable that flips loses focus in the middle of typing.
        if (!input.onCanEdit) setEditorReadOnly(forceReadOnly || !canEdit)
        input.onCanEdit?.(canEdit)
      },
    })
    await provider.start()
    if (
      status.current === 'storage-error' ||
      status.current === 'unauthorized' ||
      status.current === 'forbidden'
    )
      throw new Error(`collaboration cannot start: ${status.current}`)
    if (status.current === 'closed' || status.current === 'recovery-required')
      editorReadOnly = true

    const blocks = blockEditing()
    const editor = createDocumentBodyEditor(mount, document, {
      readOnly: editorReadOnly,
      plugins: blocks.plugins,
      nodeViews: blocks.nodeViews,
      onEditorReady: blocks.attach,
      onBodyChange: input.onBodyChange,
      onDeleteNode: (nodeIDs) => provider!.deleteNode(nodeIDs),
      onDeleteNodeQueued: input.onDeleteNodeQueued,
      onCaretHint: (hint) => caretHints.set(input.documentID, hint),
      onMoveNode: (move) => provider!.moveNode(move),
      onMoveNodeQueued: input.onMoveNodeQueued,
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
      onSelectionChange: cursorSender.send,
    })
    showRemoteCursors = (cursors) => editor.setRemoteCursors(cursors)
    const placeCaret = () => {
      const caretHint = caretHints.get(input.documentID)
      caretHints.delete(input.documentID)
      if (caretHint && !editorReadOnly)
        requestAnimationFrame(() =>
          editor.focusBlock(caretHint.nodeID, caretHint.edge)
        )
    }
    finishStructural = () => {
      editor.finishStructuralCommand()
      placeCaret()
    }
    placeCaret()
    if (input.focusNodeID) {
      requestAnimationFrame(() => {
        const target = Array.from(
          mount.querySelectorAll<HTMLElement>('[data-node-id]')
        ).find((node) => node.dataset.nodeId === input.focusNodeID)
        target?.scrollIntoView?.({ block: 'center' })
      })
    }
    setEditorReadOnly = (readOnly) => {
      editorReadOnly = readOnly
      editor.setReadOnly(readOnly)
    }
    let editorDestroyed = false
    destroyEditor = () => {
      if (editorDestroyed) return
      editorDestroyed = true
      cursorSender.cancel()
      editor.destroy()
    }
    return {
      document,
      editor,
      provider,
      destroy() {
        provider?.stop()
        destroyEditor()
        destroyBody()
      },
    }
  } catch (error) {
    provider?.stop()
    destroyEditor()
    destroyBody()
    throw error
  }
}

const cursorIntervalMs = 100

/**
 * Sends the first selection change at once, then at most one per interval
 * (the latest wins). A null selection (focus lost) is sent immediately so
 * others stop seeing a cursor that is no longer there.
 */
function createCursorSender(
  send: (selection: DocumentBodySelection | null) => void
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: DocumentBodySelection | null | undefined
  const flush = () => {
    timer = undefined
    if (pending === undefined) return
    const next = pending
    pending = undefined
    send(next)
    timer = setTimeout(flush, cursorIntervalMs)
  }
  return {
    send(selection: DocumentBodySelection | null) {
      pending = selection
      if (selection === null || timer === undefined) {
        if (timer) clearTimeout(timer)
        flush()
      }
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = undefined
      pending = undefined
    },
  }
}
