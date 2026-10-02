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
import type { InlineState } from './prosemirror/inlineMarks'

type CollaborativeBodySnapshot = {
  bodyVersion: number
  bodyEpoch: number
  bodySchemaVersion: number
  canEdit: boolean
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
    onCanonicalBody?: (body: MarkdownBodySnapshot) => void
    onHeldEdits?: (edits: HeldEdit[]) => void
    onBodyChange?: (body: DocumentBodyNode[]) => void
    onDeleteNodeQueued?: (nodeID: string) => void
    onMoveNodeQueued?: (move: MoveNodeIntent) => void
    onTransactionError?: (error: unknown) => void
    onHistoryChange?: (history: EditorHistoryState) => void
    onInlineStateChange?: (state: InlineState) => void
    onLinkRequest?: () => void
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
      bodySchemaVersion: input.snapshot.bodySchemaVersion,
      canEdit: input.snapshot.canEdit,
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
      onCanonicalBody: input.onCanonicalBody,
      onHeldEdits: input.onHeldEdits,
      onCanEdit: (canEdit) => {
        setEditorReadOnly(forceReadOnly || !canEdit)
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
      onDeleteNode: (nodeID) => provider!.deleteNode(nodeID),
      onDeleteNodeQueued: input.onDeleteNodeQueued,
      onMoveNode: (move) => provider!.moveNode(move),
      onMoveNodeQueued: input.onMoveNodeQueued,
      onTransactionError: input.onTransactionError,
      onHistoryChange: input.onHistoryChange,
      onInlineStateChange: input.onInlineStateChange,
      onLinkRequest: input.onLinkRequest,
      onSelectionChange: cursorSender.send,
    })
    showRemoteCursors = (cursors) => editor.setRemoteCursors(cursors)
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
