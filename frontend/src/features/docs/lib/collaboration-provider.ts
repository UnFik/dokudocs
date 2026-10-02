import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror'
import * as Y from 'yjs'
import { ApiError } from '@/lib/api-client'
import {
  deleteMarkdownNode,
  getMarkdownBody,
  moveMarkdownNode,
  type MarkdownBodySnapshot,
} from '@/lib/domain-api'
import { rebasePendingEdits, type HeldEdit } from './collaboration-rebase'
import { buildRebaseUpdate } from './collaboration-rebase-yjs'
import {
  CollaborationSocket,
  type CollaborationSocketOptions,
  decodeBase64,
  encodeBase64,
  type CursorSelection,
  type PresenceUser,
  type RemoteCursor,
} from './collaboration-socket'
import {
  IndexedDBCollaborationStore,
  deleteTargets,
  type CollaborationScope,
  type CollaborationSnapshot,
  type CollaborationStore,
  type PendingDeleteNodeCommand,
  type PendingMoveNodeCommand,
  type PendingCollaborationUpdate,
} from './collaboration-store'
import type { DocumentBodyNode } from './documentBody'
import {
  documentBodySchema,
  prosemirrorToDocumentBody,
} from './prosemirror/documentBody'

export type CollaborativeDocumentStatus =
  | 'connecting'
  | 'ready'
  | 'offline'
  | 'storage-error'
  | 'recovery-required'
  | 'unauthorized'
  | 'forbidden'
  | 'closed'

// At most two update messages per second per editor: the first edit after a
// pause goes out at once, edits that follow are merged into one update.
const defaultBatchIntervalMs = 500

export type RecoveryReason =
  | 'epoch-changed'
  | 'schema-changed'
  | 'pending-update-incompatible'
  | 'update-rejected'

export type CollaborativeDocumentProviderOptions = Omit<
  CollaborationSocketOptions,
  'onFrame' | 'onStatus' | 'socketFactory' | 'token'
> & {
  token: string | (() => string)
  userID: string
  document: Y.Doc
  bodyVersion: number
  bodyEpoch: number
  bodySchemaVersion: number
  canEdit?: boolean
  store?: CollaborationStore
  socketFactory?: CollaborationSocketOptions['socketFactory']
  onStatus?: (status: CollaborativeDocumentStatus) => void
  onBodyVersion?: (version: number) => void
  onCanEdit?: (canEdit: boolean) => void
  onPresence?: (users: PresenceUser[]) => void
  /** Current cursors of other connections; [] after a disconnect. */
  onRemoteCursors?: (cursors: RemoteCursor[]) => void
  batchIntervalMs?: number
  executeDeleteNode?: (
    command: PendingDeleteNodeCommand
  ) => Promise<MarkdownBodySnapshot>
  executeMoveNode?: (
    command: PendingMoveNodeCommand
  ) => Promise<MarkdownBodySnapshot>
  refreshCanonicalBody?: () => Promise<MarkdownBodySnapshot>
  onCanonicalBody?: (body: MarkdownBodySnapshot) => void
  /** Called when a partial rebase kept some conflicting edits back for review. */
  onHeldEdits?: (edits: HeldEdit[]) => void
  onRecovery?: (
    reason: RecoveryReason,
    pending: PendingCollaborationUpdate[],
    deleteCommands: PendingDeleteNodeCommand[],
    moveCommands: PendingMoveNodeCommand[]
  ) => void
}

const activeProviders = new Map<string, CollaborativeDocumentProvider>()

/** The running provider for this user and document, if the editor is open. */
export function activeProviderFor(scope: CollaborationScope) {
  return activeProviders.get(`${scope.userID}:${scope.documentID}`)
}

export class CollaborativeDocumentProvider {
  private readonly scope: CollaborationScope
  private readonly store: CollaborationStore
  private readonly remoteOrigin = {}
  private readonly pending = new Map<string, PendingCollaborationUpdate>()
  private readonly pendingDeleteCommands = new Map<
    string,
    PendingDeleteNodeCommand
  >()
  private readonly pendingMoveCommands = new Map<
    string,
    PendingMoveNodeCommand
  >()
  private readonly sentThisConnection = new Set<string>()
  private socket?: CollaborationSocket
  private readonly remoteCursors = new Map<string, RemoteCursor>()
  private status: CollaborativeDocumentStatus = 'connecting'
  private canEdit?: boolean
  private canSuggest = false
  private bodyVersion: number
  private ready = false
  private stopped = false
  private terminal = false
  private storageFailed = false
  private reconnectAttempt = 0
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private storageQueue: Promise<void> = Promise.resolve()
  private started = false
  private applyingCommand = false
  private canonicalRefreshStarted = false
  private rebasing = false
  private lastBatchSentAt = 0
  private batchTimer?: ReturnType<typeof setTimeout>
  private readonly batches = new Map<string, string[]>()
  private baseState?: Uint8Array
  private savesInFlight = 0

  private readonly captureBaseState = (transaction: Y.Transaction) => {
    if (
      this.baseState ||
      transaction.origin === this.remoteOrigin ||
      this.stopped ||
      this.terminal ||
      this.storageFailed
    )
      return
    this.baseState = Y.encodeStateAsUpdate(this.options.document)
  }

  private readonly handleYUpdate = (update: Uint8Array, origin: unknown) => {
    if (
      origin === this.remoteOrigin ||
      this.stopped ||
      this.terminal ||
      this.storageFailed
    )
      return
    const pending: PendingCollaborationUpdate = {
      updateID: crypto.randomUUID(),
      bodyEpoch: this.options.bodyEpoch,
      bodySchemaVersion: this.options.bodySchemaVersion,
      update: update.slice(),
    }
    const snapshot = this.snapshot()
    this.savesInFlight++
    void this.enqueueStorage(async () => {
      try {
        await this.store.saveUpdate(this.scope, snapshot, pending)
        this.pending.set(pending.updateID, pending)
      } finally {
        this.savesInFlight--
      }
      this.flushPending()
    })
  }

  constructor(private readonly options: CollaborativeDocumentProviderOptions) {
    this.scope = { userID: options.userID, documentID: options.documentID }
    this.store = options.store ?? new IndexedDBCollaborationStore()
    this.bodyVersion = options.bodyVersion
    this.canEdit = options.canEdit === true
  }

  async start() {
    if (this.started || this.stopped || this.socket || this.storageFailed)
      return
    this.started = true
    activeProviders.set(`${this.scope.userID}:${this.scope.documentID}`, this)
    this.setStatus('connecting')
    try {
      const stored = await this.store.load(this.scope)
      for (const update of stored.updates)
        this.pending.set(update.updateID, update)
      for (const command of stored.deleteCommands)
        this.pendingDeleteCommands.set(command.commandID, command)
      for (const command of stored.moveCommands)
        this.pendingMoveCommands.set(command.commandID, command)
      const hasPendingChanges =
        this.pending.size > 0 ||
        this.pendingDeleteCommands.size > 0 ||
        this.pendingMoveCommands.size > 0
      const snapshotEpochMismatch =
        stored.snapshot && stored.snapshot.bodyEpoch !== this.options.bodyEpoch
      const snapshotSchemaMismatch =
        stored.snapshot &&
        stored.snapshot.bodySchemaVersion !== this.options.bodySchemaVersion
      if (hasPendingChanges && snapshotEpochMismatch) {
        if (
          stored.snapshot &&
          stored.snapshot.bodyEpoch < this.options.bodyEpoch &&
          this.hasPendingStructuralCommand()
        ) {
          await this.reconcileStructuralReceipt(this.options.bodyEpoch, false)
          return
        }
        if (
          stored.snapshot &&
          stored.snapshot.bodyEpoch < this.options.bodyEpoch &&
          this.pending.size > 0 &&
          !this.hasPendingStructuralCommand() &&
          (await this.rebaseStored(stored.snapshot))
        )
          return
        this.requireRecovery('epoch-changed', false)
        return
      }
      if (hasPendingChanges && snapshotSchemaMismatch) {
        this.requireRecovery('schema-changed', false)
        return
      }
      if (
        [...this.pending.values()].some(
          (update) =>
            update.bodyEpoch !== this.options.bodyEpoch ||
            update.bodySchemaVersion !== this.options.bodySchemaVersion
        )
      ) {
        this.requireRecovery('pending-update-incompatible')
        return
      }
      const incompatibleCommand = [...this.pendingDeleteCommands.values()].find(
        (command) => !this.isCurrentCommand(command)
      )
      const incompatibleMove = [...this.pendingMoveCommands.values()].find(
        (command) => !this.isCurrentCommand(command)
      )
      if (incompatibleCommand || incompatibleMove) {
        const command = incompatibleCommand ?? incompatibleMove!
        this.requireRecovery(
          command.bodyEpoch !== this.options.bodyEpoch
            ? 'epoch-changed'
            : 'schema-changed',
          false
        )
        return
      }
      if (
        stored.snapshot &&
        !snapshotEpochMismatch &&
        !snapshotSchemaMismatch
      ) {
        this.bodyVersion = Math.max(
          this.bodyVersion,
          stored.snapshot.bodyVersion
        )
        Y.applyUpdate(
          this.options.document,
          stored.snapshot.encodedState,
          this.remoteOrigin
        )
      }
      for (const update of this.pending.values())
        Y.applyUpdate(this.options.document, update.update, this.remoteOrigin)
      if (this.pending.size > 0 && stored.snapshot?.baseEncodedState)
        this.baseState = stored.snapshot.baseEncodedState
      this.options.document.on('beforeTransaction', this.captureBaseState)
      this.options.document.on('update', this.handleYUpdate)
      const snapshot = this.snapshot()
      await this.enqueueStorage(() =>
        this.store.saveSnapshot(this.scope, snapshot)
      )
      if (this.storageFailed || this.stopped) return
      this.connect()
    } catch {
      this.failStorage()
    }
  }

  /**
   * Resolves true once every pending update and command is acknowledged and
   * stored, false if the connection cannot get there within the timeout or
   * the provider stopped, was refused, or needs recovery.
   */
  async whenDrained(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      if (this.stopped || this.terminal || this.storageFailed) return false
      if (
        this.started &&
        this.pending.size === 0 &&
        !this.hasPendingStructuralCommand()
      ) {
        await this.storageQueue
        return this.pending.size === 0 && !this.hasPendingStructuralCommand()
      }
      if (Date.now() >= deadline) return false
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }

  /** Resolves when queued local-storage writes have finished. */
  settled(): Promise<void> {
    return this.storageQueue
  }

  stop() {
    if (this.stopped) return
    this.stopped = true
    this.ready = false
    const activeKey = `${this.scope.userID}:${this.scope.documentID}`
    if (activeProviders.get(activeKey) === this)
      activeProviders.delete(activeKey)
    this.options.document.off('update', this.handleYUpdate)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.batchTimer) clearTimeout(this.batchTimer)
    this.socket?.close()
    this.setStatus('closed')
  }

  /** Shares the local selection (null clears it). Never queued or stored. */
  sendCursor(selection: CursorSelection | null) {
    return this.ready && this.socket ? this.socket.sendCursor(selection) : false
  }

  /** Deletes one subtree, or several at once in a single body epoch. */
  async deleteNode(target: string | string[]) {
    const nodeIDs = Array.isArray(target) ? [...new Set(target)] : [target]
    if (!nodeIDs.length || nodeIDs.some((nodeID) => !nodeID))
      throw new Error('node ID is required')
    if (this.hasPendingStructuralCommand())
      throw new Error('a structural command is already pending')
    if (this.stopped || this.terminal || this.storageFailed)
      throw new Error('collaboration provider cannot queue DeleteNode')
    const command: PendingDeleteNodeCommand = {
      commandID: crypto.randomUUID(),
      bodyEpoch: this.options.bodyEpoch,
      bodySchemaVersion: this.options.bodySchemaVersion,
      nodeID: nodeIDs[0]!,
      ...(nodeIDs.length > 1 ? { nodeIDs } : {}),
    }
    await this.enqueueStorage(() =>
      this.store.saveDeleteCommand(this.scope, this.snapshot(), command)
    )
    if (this.storageFailed || this.stopped)
      throw new Error('DeleteNode could not be saved locally')
    this.pendingDeleteCommands.set(command.commandID, command)
    this.flushPending()
  }

  async moveNode(
    move: Pick<
      PendingMoveNodeCommand,
      'nodeID' | 'targetParentID' | 'beforeNodeID'
    >
  ) {
    if (!move.nodeID || !move.targetParentID)
      throw new Error('MoveNode requires a node and target parent')
    if (this.hasPendingStructuralCommand())
      throw new Error('a structural command is already pending')
    if (this.stopped || this.terminal || this.storageFailed)
      throw new Error('collaboration provider cannot queue MoveNode')
    const command: PendingMoveNodeCommand = {
      commandID: crypto.randomUUID(),
      bodyEpoch: this.options.bodyEpoch,
      bodySchemaVersion: this.options.bodySchemaVersion,
      ...move,
    }
    await this.enqueueStorage(() =>
      this.store.saveMoveCommand(this.scope, this.snapshot(), command)
    )
    if (this.storageFailed || this.stopped)
      throw new Error('MoveNode could not be saved locally')
    this.pendingMoveCommands.set(command.commandID, command)
    this.flushPending()
  }

  private connect() {
    if (this.stopped || this.terminal || this.storageFailed) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.setStatus('offline')
      this.scheduleReconnect()
      return
    }
    try {
      const token =
        typeof this.options.token === 'function'
          ? this.options.token()
          : this.options.token
      if (!token) {
        this.terminal = true
        this.setStatus('unauthorized')
        return
      }
      this.socket = new CollaborationSocket({
        documentID: this.options.documentID,
        workspaceID: this.options.workspaceID,
        token,
        baseURL: this.options.baseURL,
        socketFactory: this.options.socketFactory,
        onFrame: (frame) => this.receive(frame),
        onStatus: (status) => {
          if (status === 'closed') this.disconnected()
        },
      })
      this.sentThisConnection.clear()
      this.setStatus('connecting')
    } catch {
      this.setStatus('offline')
      this.scheduleReconnect()
    }
  }

  private receive(frame: Parameters<CollaborationSocketOptions['onFrame']>[0]) {
    switch (frame.type) {
      case 'ready':
        void this.initialize(frame)
        return
      case 'resync':
        void this.applyResync(frame)
        return
      case 'update':
        void this.applyRemoteUpdate(frame)
        return
      case 'presence':
        this.options.onPresence?.(frame.users ?? [])
        return
      case 'cursor':
      case 'cursor_leave':
        if (!frame.cursor) return
        if (frame.type === 'cursor')
          this.remoteCursors.set(frame.cursor.connectionID, frame.cursor)
        else this.remoteCursors.delete(frame.cursor.connectionID)
        this.options.onRemoteCursors?.([...this.remoteCursors.values()])
        return
      case 'ack':
        void this.acknowledge(frame)
        return
      case 'error':
        void this.handleError(frame.code ?? 'update_rejected')
    }
  }

  private async initialize(
    frame: Parameters<CollaborationSocketOptions['onFrame']>[0]
  ) {
    if (
      !frame.state ||
      frame.bodyEpoch === undefined ||
      frame.bodySchemaVersion === undefined ||
      frame.bodyVersion === undefined ||
      typeof frame.canEdit !== 'boolean'
    ) {
      this.requireRecovery('update-rejected')
      return
    }
    if (frame.bodyEpoch !== this.options.bodyEpoch) {
      if (
        frame.bodyEpoch > this.options.bodyEpoch &&
        frame.bodySchemaVersion === this.options.bodySchemaVersion &&
        this.hasPendingStructuralCommand()
      ) {
        void this.reconcileStructuralReceipt(frame.bodyEpoch)
        return
      }
      if (
        frame.bodyEpoch > this.options.bodyEpoch &&
        frame.bodySchemaVersion === this.options.bodySchemaVersion &&
        this.pending.size > 0 &&
        !this.hasPendingStructuralCommand()
      ) {
        void this.rebaseOnline()
        return
      }
      this.requireRecovery('epoch-changed')
      return
    }
    if (frame.bodySchemaVersion !== this.options.bodySchemaVersion) {
      this.requireRecovery('schema-changed')
      return
    }
    if (
      [...this.pending.values()].some(
        (update) =>
          update.bodyEpoch !== frame.bodyEpoch ||
          update.bodySchemaVersion !== frame.bodySchemaVersion
      )
    ) {
      this.requireRecovery('pending-update-incompatible')
      return
    }
    const incompatibleCommand = [...this.pendingDeleteCommands.values()].find(
      (command) =>
        !this.isCurrentCommand(
          command,
          frame.bodyEpoch,
          frame.bodySchemaVersion
        )
    )
    if (incompatibleCommand) {
      this.requireRecovery(
        incompatibleCommand.bodyEpoch !== frame.bodyEpoch
          ? 'epoch-changed'
          : 'schema-changed'
      )
      return
    }
    const incompatibleMove = [...this.pendingMoveCommands.values()].find(
      (command) =>
        !this.isCurrentCommand(
          command,
          frame.bodyEpoch,
          frame.bodySchemaVersion
        )
    )
    if (incompatibleMove) {
      this.requireRecovery(
        incompatibleMove.bodyEpoch !== frame.bodyEpoch
          ? 'epoch-changed'
          : 'schema-changed'
      )
      return
    }

    try {
      this.bodyVersion = frame.bodyVersion
      this.canEdit = frame.canEdit
      this.canSuggest = frame.canSuggest === true
      Y.applyUpdate(this.options.document, frame.state, this.remoteOrigin)
      for (const pending of this.pending.values())
        Y.applyUpdate(this.options.document, pending.update, this.remoteOrigin)
      const snapshot = this.snapshot()
      await this.enqueueStorage(() =>
        this.store.saveSnapshot(this.scope, snapshot)
      )
      if (this.storageFailed || this.stopped) return
      this.options.onCanEdit?.(frame.canEdit)
      this.ready = true
      this.reconnectAttempt = 0
      this.options.onBodyVersion?.(this.bodyVersion)
      this.setStatus('ready')
      this.flushPending()
    } catch {
      this.requireRecovery('update-rejected')
    }
  }

  private async applyResync(
    frame: Parameters<CollaborationSocketOptions['onFrame']>[0]
  ) {
    if (!this.isCurrentGeneration(frame) || !frame.state) {
      if (
        frame.bodyEpoch !== undefined &&
        frame.bodyEpoch > this.options.bodyEpoch &&
        frame.bodySchemaVersion === this.options.bodySchemaVersion &&
        this.pending.size > 0 &&
        !this.hasPendingStructuralCommand()
      ) {
        void this.rebaseOnline()
        return
      }
      this.requireRecovery(this.generationMismatchReason(frame))
      return
    }
    try {
      this.bodyVersion = frame.bodyVersion!
      this.canEdit = frame.canEdit
      this.canSuggest = frame.canSuggest === true
      Y.applyUpdate(this.options.document, frame.state, this.remoteOrigin)
      const snapshot = this.snapshot()
      await this.enqueueStorage(() =>
        this.store.saveSnapshot(this.scope, snapshot)
      )
      this.options.onCanEdit?.(this.canEdit === true)
      // Someone who can only suggest still sends their updates; a structural
      // command is an edit and needs edit access.
      if (
        (!this.canEdit && !this.canSuggest && this.pending.size) ||
        (!this.canEdit && this.hasPendingStructuralCommand())
      ) {
        this.requireRecovery('update-rejected')
        return
      }
      this.flushPending()
      this.options.onBodyVersion?.(this.bodyVersion)
    } catch {
      this.requireRecovery('update-rejected')
    }
  }

  private async applyRemoteUpdate(
    frame: Parameters<CollaborationSocketOptions['onFrame']>[0]
  ) {
    if (!this.isCurrentGeneration(frame) || !frame.update) {
      this.requireRecovery(this.generationMismatchReason(frame))
      return
    }
    try {
      this.bodyVersion = frame.bodyVersion!
      Y.applyUpdate(this.options.document, frame.update, this.remoteOrigin)
      const snapshot = this.snapshot()
      await this.enqueueStorage(() =>
        this.store.saveSnapshot(this.scope, snapshot)
      )
      this.options.onBodyVersion?.(this.bodyVersion)
    } catch {
      this.requireRecovery('update-rejected')
    }
  }

  private async acknowledge(
    frame: Parameters<CollaborationSocketOptions['onFrame']>[0]
  ) {
    if (
      !frame.updateID ||
      frame.bodyEpoch !== this.options.bodyEpoch ||
      frame.bodySchemaVersion !== this.options.bodySchemaVersion
    ) {
      this.requireRecovery(this.generationMismatchReason(frame))
      return
    }
    const acknowledged = (
      this.batches.get(frame.updateID) ?? [frame.updateID]
    ).filter((updateID) => this.pending.has(updateID))
    if (!acknowledged.length) return
    this.bodyVersion = Math.max(
      this.bodyVersion,
      frame.bodyVersion ?? this.bodyVersion
    )
    const drains =
      this.pending.size === acknowledged.length && this.savesInFlight === 0
    const snapshot = this.snapshot(!drains)
    await this.enqueueStorage(() =>
      this.store.acknowledgeMany(this.scope, acknowledged, snapshot)
    )
    if (this.storageFailed || this.stopped) return
    this.batches.delete(frame.updateID)
    for (const updateID of acknowledged) {
      this.pending.delete(updateID)
      this.sentThisConnection.delete(updateID)
    }
    if (drains && this.savesInFlight === 0) this.baseState = undefined
    this.options.onBodyVersion?.(this.bodyVersion)
    this.flushPending()
  }

  private async handleError(code: string) {
    if (code === 'forbidden') {
      this.terminal = true
      this.ready = false
      this.options.document.off('update', this.handleYUpdate)
      this.setStatus('forbidden')
      try {
        await this.store.clear(this.scope)
        this.pending.clear()
        this.pendingDeleteCommands.clear()
        this.pendingMoveCommands.clear()
      } catch {
        this.failStorage()
      }
      this.socket?.close()
      return
    }
    if (code === 'unavailable') {
      // The server's store is down (failover, restart). The update was never
      // committed, so keep it pending and let the reconnect backoff resend it.
      this.socket?.close()
      return
    }
    if (code === 'unauthorized') {
      this.terminal = true
      this.ready = false
      this.options.document.off('update', this.handleYUpdate)
      this.setStatus('unauthorized')
      this.socket?.close()
      return
    }
    if (
      code === 'stale_epoch' &&
      this.pending.size > 0 &&
      !this.hasPendingStructuralCommand()
    ) {
      void this.rebaseOnline()
      return
    }
    this.requireRecovery(
      code === 'stale_epoch'
        ? 'epoch-changed'
        : code === 'schema_mismatch'
          ? 'schema-changed'
          : 'update-rejected'
    )
  }

  private isCurrentGeneration(
    frame: Parameters<CollaborationSocketOptions['onFrame']>[0]
  ) {
    return (
      frame.bodyEpoch === this.options.bodyEpoch &&
      frame.bodySchemaVersion === this.options.bodySchemaVersion &&
      frame.bodyVersion !== undefined &&
      (frame.type === 'update' || typeof frame.canEdit === 'boolean')
    )
  }

  private generationMismatchReason(
    frame: Parameters<CollaborationSocketOptions['onFrame']>[0]
  ): RecoveryReason {
    return frame.bodyEpoch !== this.options.bodyEpoch
      ? 'epoch-changed'
      : frame.bodySchemaVersion !== this.options.bodySchemaVersion
        ? 'schema-changed'
        : 'update-rejected'
  }

  private requireRecovery(
    reason: RecoveryReason,
    refreshCanonical = reason === 'epoch-changed'
  ) {
    this.ready = false
    this.terminal = true
    this.options.document.off('update', this.handleYUpdate)
    this.setStatus('recovery-required')
    this.options.onRecovery?.(
      reason,
      [...this.pending.values()],
      [...this.pendingDeleteCommands.values()],
      [...this.pendingMoveCommands.values()]
    )
    this.socket?.close()
    if (refreshCanonical) void this.refreshCanonicalBody()
  }

  private async refreshCanonicalBody() {
    if (this.canonicalRefreshStarted || this.stopped) return
    this.canonicalRefreshStarted = true
    try {
      const body = this.options.refreshCanonicalBody
        ? await this.options.refreshCanonicalBody()
        : await getMarkdownBody(
            this.options.workspaceID,
            this.options.documentID
          )
      if (
        body.bodyEpoch < this.options.bodyEpoch ||
        body.bodySchemaVersion !== this.options.bodySchemaVersion
      )
        return
      if (this.pending.size === 0 && !this.hasPendingStructuralCommand()) {
        await this.enqueueStorage(() =>
          this.store.saveSnapshot(this.scope, {
            bodyVersion: body.bodyVersion,
            bodyEpoch: body.bodyEpoch,
            bodySchemaVersion: body.bodySchemaVersion,
            canEdit: body.canEdit,
            encodedState: decodeBase64(body.encodedState),
          })
        )
      }
      if (!this.stopped) this.options.onCanonicalBody?.(body)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.setStatus('unauthorized')
      } else if (
        error instanceof ApiError &&
        (error.status === 403 || error.status === 404)
      ) {
        this.setStatus('forbidden')
        try {
          await this.store.clear(this.scope)
          this.pending.clear()
          this.pendingDeleteCommands.clear()
          this.pendingMoveCommands.clear()
        } catch {
          this.failStorage()
        }
      }
    }
  }

  private flushPending() {
    if (!this.ready || !this.socket) return
    if (!this.canEdit) {
      if (this.hasPendingStructuralCommand() || !this.canSuggest) {
        if (this.pending.size || this.hasPendingStructuralCommand())
          this.requireRecovery('update-rejected')
        return
      }
    }
    const unsent = [...this.pending.values()].filter(
      (update) => !this.sentThisConnection.has(update.updateID)
    )
    if (unsent.length) {
      const wait =
        this.lastBatchSentAt +
        (this.options.batchIntervalMs ?? defaultBatchIntervalMs) -
        Date.now()
      if (wait > 0) this.scheduleBatchFlush(wait)
      else if (!this.sendBatch(unsent)) return
    }
    if (this.pending.size === 0) {
      if (this.pendingDeleteCommands.size) void this.flushDeleteCommand()
      else if (this.pendingMoveCommands.size) void this.flushMoveCommand()
    }
  }

  private scheduleBatchFlush(delay: number) {
    if (this.batchTimer) return
    this.batchTimer = setTimeout(() => {
      this.batchTimer = undefined
      this.flushPending()
    }, delay)
  }

  // Persisted updates stay individual; only the message on the wire is merged.
  // The server acknowledges the merged ID, which maps back to its members.
  private sendBatch(unsent: PendingCollaborationUpdate[]) {
    const groups: PendingCollaborationUpdate[][] = []
    for (const update of unsent) {
      const group = groups.at(-1)
      if (
        group &&
        group[0]!.bodyEpoch === update.bodyEpoch &&
        group[0]!.bodySchemaVersion === update.bodySchemaVersion
      )
        group.push(update)
      else groups.push([update])
    }
    for (const group of groups) {
      const first = group[0]!
      const merged = group.length === 1
      const updateID = merged ? first.updateID : crypto.randomUUID()
      const sent = this.socket!.sendUpdate({
        updateID,
        bodyEpoch: first.bodyEpoch,
        bodySchemaVersion: first.bodySchemaVersion,
        update: merged
          ? first.update
          : Y.mergeUpdates(group.map((update) => update.update)),
      })
      if (!sent) return false
      if (!merged)
        this.batches.set(
          updateID,
          group.map((update) => update.updateID)
        )
      for (const update of group) this.sentThisConnection.add(update.updateID)
      this.lastBatchSentAt = Date.now()
    }
    return true
  }

  private async flushDeleteCommand() {
    if (
      this.applyingCommand ||
      !this.ready ||
      !this.canEdit ||
      this.pending.size > 0 ||
      this.pendingDeleteCommands.size === 0
    )
      return
    const command = this.pendingDeleteCommands.values().next().value
    if (!command) return
    if (!this.isCurrentCommand(command)) {
      this.requireRecovery('epoch-changed')
      return
    }

    this.applyingCommand = true
    try {
      const body = this.options.executeDeleteNode
        ? await this.options.executeDeleteNode(command)
        : await executeDeleteNode(
            this.options.workspaceID,
            this.options.documentID,
            command
          )
      if (body.bodyEpoch < command.bodyEpoch) {
        this.requireRecovery('epoch-changed')
        return
      }
      if (body.bodySchemaVersion !== command.bodySchemaVersion) {
        this.requireRecovery('schema-changed')
        return
      }
      const canonicalSnapshot: CollaborationSnapshot = {
        bodyVersion: body.bodyVersion,
        bodyEpoch: body.bodyEpoch,
        bodySchemaVersion: body.bodySchemaVersion,
        canEdit: body.canEdit,
        encodedState: decodeBase64(body.encodedState),
      }
      await this.enqueueStorage(() =>
        this.store.completeDeleteCommand(
          this.scope,
          command.commandID,
          canonicalSnapshot
        )
      )
      if (this.storageFailed || this.stopped) return
      this.pendingDeleteCommands.delete(command.commandID)
      this.terminal = true
      this.ready = false
      this.options.document.off('update', this.handleYUpdate)
      this.socket?.close()
      this.setStatus('closed')
      this.options.onCanonicalBody?.(body)
      if (this.hasPendingStructuralCommand())
        this.requireRecovery('epoch-changed')
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.terminal = true
        this.ready = false
        this.options.document.off('update', this.handleYUpdate)
        this.setStatus('unauthorized')
        this.socket?.close()
      } else if (error instanceof ApiError && error.status === 409) {
        if (!(await this.retargetStructuralCommand()))
          this.requireRecovery('epoch-changed')
      } else if (error instanceof ApiError && error.status === 403) {
        this.requireRecovery('update-rejected')
      } else if (
        error instanceof ApiError &&
        error.status < 500 &&
        error.status !== 408 &&
        error.status !== 429
      ) {
        this.requireRecovery('update-rejected')
      } else {
        this.socket?.close()
      }
    } finally {
      this.applyingCommand = false
    }
  }

  private isCurrentCommand(
    command: Pick<PendingDeleteNodeCommand, 'bodyEpoch' | 'bodySchemaVersion'>,
    bodyEpoch = this.options.bodyEpoch,
    bodySchemaVersion = this.options.bodySchemaVersion
  ) {
    return (
      command.bodyEpoch === bodyEpoch &&
      command.bodySchemaVersion === bodySchemaVersion
    )
  }

  private async flushMoveCommand() {
    if (
      this.applyingCommand ||
      !this.ready ||
      !this.canEdit ||
      this.pending.size > 0 ||
      this.pendingMoveCommands.size === 0
    )
      return
    const command = this.pendingMoveCommands.values().next().value
    if (!command) return
    if (!this.isCurrentCommand(command)) {
      this.requireRecovery('epoch-changed')
      return
    }

    this.applyingCommand = true
    try {
      const body = this.options.executeMoveNode
        ? await this.options.executeMoveNode(command)
        : await executeMoveNode(
            this.options.workspaceID,
            this.options.documentID,
            command
          )
      if (body.bodyEpoch < command.bodyEpoch) {
        this.requireRecovery('epoch-changed')
        return
      }
      if (body.bodySchemaVersion !== command.bodySchemaVersion) {
        this.requireRecovery('schema-changed')
        return
      }
      const canonicalSnapshot: CollaborationSnapshot = {
        bodyVersion: body.bodyVersion,
        bodyEpoch: body.bodyEpoch,
        bodySchemaVersion: body.bodySchemaVersion,
        canEdit: body.canEdit,
        encodedState: decodeBase64(body.encodedState),
      }
      await this.enqueueStorage(() =>
        this.store.completeMoveCommand(
          this.scope,
          command.commandID,
          canonicalSnapshot
        )
      )
      if (this.storageFailed || this.stopped) return
      this.pendingMoveCommands.delete(command.commandID)
      this.terminal = true
      this.ready = false
      this.options.document.off('update', this.handleYUpdate)
      this.socket?.close()
      this.setStatus('closed')
      this.options.onCanonicalBody?.(body)
      if (this.hasPendingStructuralCommand())
        this.requireRecovery('epoch-changed')
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.terminal = true
        this.ready = false
        this.options.document.off('update', this.handleYUpdate)
        this.setStatus('unauthorized')
        this.socket?.close()
      } else if (error instanceof ApiError && error.status === 409) {
        if (!(await this.retargetStructuralCommand()))
          this.requireRecovery('epoch-changed')
      } else if (error instanceof ApiError && error.status === 403) {
        this.requireRecovery('update-rejected')
      } else if (
        error instanceof ApiError &&
        error.status < 500 &&
        error.status !== 408 &&
        error.status !== 429
      ) {
        this.requireRecovery('update-rejected')
      } else {
        this.socket?.close()
      }
    } finally {
      this.applyingCommand = false
    }
  }

  // The server rejected a structural command because the epoch moved on. Its
  // intent is addressed by node ID, so it is still valid when the nodes it names
  // still make sense in the current body: re-issue it at the new epoch under a
  // new ID (the original ID was already tried, so a lost receipt is not
  // duplicated). Otherwise the command stays on the device for review.
  private async retargetStructuralCommand(): Promise<boolean> {
    const deleteCommand = this.pendingDeleteCommands.values().next().value
    const moveCommand = this.pendingMoveCommands.values().next().value
    if (!deleteCommand === !moveCommand || this.pending.size > 0) return false
    const command = (deleteCommand ?? moveCommand)!
    try {
      const body = this.options.refreshCanonicalBody
        ? await this.options.refreshCanonicalBody()
        : await getMarkdownBody(
            this.options.workspaceID,
            this.options.documentID
          )
      if (
        body.bodyEpoch <= command.bodyEpoch ||
        body.bodySchemaVersion !== command.bodySchemaVersion
      )
        return false
      const verdict = deleteCommand
        ? deleteStillMakesSense(body.nodes, deleteTargets(deleteCommand))
        : moveStillMakesSense(body.nodes, moveCommand!)
      if (verdict === 'unsafe') return false
      // Targets someone else already deleted are dropped from a re-issued batch.
      let remaining: string[] = []
      if (deleteCommand && verdict === 'reissue') {
        const present = new Set(body.nodes.map((node) => node.nodeID))
        remaining = deleteTargets(deleteCommand).filter((id) => present.has(id))
        // Deleting a block someone else has since filled would destroy content
        // this user never saw, so only an unchanged subtree is deleted unseen.
        const seen = (await this.store.load(this.scope)).snapshot
        if (
          !seen ||
          !remaining.every((id) =>
            sameSubtree(projectState(seen.encodedState), body.nodes, id)
          )
        )
          return false
      }

      const canonicalSnapshot: CollaborationSnapshot = {
        bodyVersion: body.bodyVersion,
        bodyEpoch: body.bodyEpoch,
        bodySchemaVersion: body.bodySchemaVersion,
        canEdit: body.canEdit,
        encodedState: decodeBase64(body.encodedState),
      }
      if (verdict === 'done') {
        await this.enqueueStorage(() =>
          this.store.completeDeleteCommand(
            this.scope,
            command.commandID,
            canonicalSnapshot
          )
        )
        this.pendingDeleteCommands.delete(command.commandID)
      } else if (deleteCommand) {
        const { nodeIDs: _previous, ...single } = deleteCommand
        const reissued: PendingDeleteNodeCommand = {
          ...single,
          nodeID: remaining[0]!,
          ...(remaining.length > 1 ? { nodeIDs: remaining } : {}),
          commandID: crypto.randomUUID(),
          bodyEpoch: body.bodyEpoch,
        }
        await this.enqueueStorage(() =>
          this.store.replaceDeleteCommand(
            this.scope,
            canonicalSnapshot,
            deleteCommand.commandID,
            reissued
          )
        )
        this.pendingDeleteCommands.delete(deleteCommand.commandID)
        this.pendingDeleteCommands.set(reissued.commandID, reissued)
      } else {
        const reissued = {
          ...moveCommand!,
          commandID: crypto.randomUUID(),
          bodyEpoch: body.bodyEpoch,
        }
        await this.enqueueStorage(() =>
          this.store.replaceMoveCommand(
            this.scope,
            canonicalSnapshot,
            moveCommand!.commandID,
            reissued
          )
        )
        this.pendingMoveCommands.delete(moveCommand!.commandID)
        this.pendingMoveCommands.set(reissued.commandID, reissued)
      }
      if (this.storageFailed || this.stopped) return true
      this.terminal = true
      this.ready = false
      this.options.document.off('update', this.handleYUpdate)
      this.socket?.close()
      this.setStatus('closed')
      this.options.onCanonicalBody?.(body)
      return true
    } catch {
      return false
    }
  }

  private async reconcileStructuralReceipt(
    serverEpoch: number,
    refreshCanonicalOnConflict = true
  ) {
    const deleteCommand = this.pendingDeleteCommands.values().next().value
    const moveCommand = this.pendingMoveCommands.values().next().value
    if (deleteCommand && moveCommand) {
      this.requireRecovery('epoch-changed')
      return
    }
    this.applyingCommand = true
    try {
      const body = deleteCommand
        ? await (this.options.executeDeleteNode
            ? this.options.executeDeleteNode(deleteCommand)
            : executeDeleteNode(
                this.options.workspaceID,
                this.options.documentID,
                deleteCommand
              ))
        : moveCommand
          ? await (this.options.executeMoveNode
              ? this.options.executeMoveNode(moveCommand)
              : executeMoveNode(
                  this.options.workspaceID,
                  this.options.documentID,
                  moveCommand
                ))
          : null
      if (!body || body.bodyEpoch < serverEpoch) {
        this.requireRecovery('epoch-changed')
        return
      }
      if (body.bodySchemaVersion !== this.options.bodySchemaVersion) {
        this.requireRecovery('schema-changed')
        return
      }
      const canonicalSnapshot: CollaborationSnapshot = {
        bodyVersion: body.bodyVersion,
        bodyEpoch: body.bodyEpoch,
        bodySchemaVersion: body.bodySchemaVersion,
        canEdit: body.canEdit,
        encodedState: decodeBase64(body.encodedState),
      }
      await this.enqueueStorage(() =>
        deleteCommand
          ? this.store.completeDeleteCommand(
              this.scope,
              deleteCommand.commandID,
              canonicalSnapshot
            )
          : this.store.completeMoveCommand(
              this.scope,
              moveCommand!.commandID,
              canonicalSnapshot
            )
      )
      if (this.storageFailed || this.stopped) return
      if (deleteCommand)
        this.pendingDeleteCommands.delete(deleteCommand.commandID)
      if (moveCommand) this.pendingMoveCommands.delete(moveCommand.commandID)
      this.terminal = true
      this.ready = false
      this.options.document.off('update', this.handleYUpdate)
      this.socket?.close()
      this.setStatus('closed')
      this.options.onCanonicalBody?.(body)
      if (this.hasPendingStructuralCommand())
        this.requireRecovery('epoch-changed')
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.terminal = true
        this.ready = false
        this.options.document.off('update', this.handleYUpdate)
        this.setStatus('unauthorized')
        this.socket?.close()
      } else if (error instanceof ApiError && error.status === 409) {
        if (!(await this.retargetStructuralCommand()))
          this.requireRecovery('epoch-changed', refreshCanonicalOnConflict)
      } else if (error instanceof ApiError && error.status === 403) {
        this.requireRecovery('update-rejected')
      } else if (
        error instanceof ApiError &&
        error.status < 500 &&
        error.status !== 408 &&
        error.status !== 429
      ) {
        this.requireRecovery('update-rejected')
      } else if (!refreshCanonicalOnConflict) {
        this.requireRecovery('epoch-changed', false)
      } else {
        this.socket?.close()
      }
    } finally {
      this.applyingCommand = false
    }
  }

  private hasPendingStructuralCommand() {
    return (
      this.pendingDeleteCommands.size > 0 || this.pendingMoveCommands.size > 0
    )
  }

  private snapshot(withBase = true): CollaborationSnapshot {
    return {
      bodyVersion: this.bodyVersion,
      bodyEpoch: this.options.bodyEpoch,
      bodySchemaVersion: this.options.bodySchemaVersion,
      canEdit: this.canEdit === true,
      encodedState: Y.encodeStateAsUpdate(this.options.document),
      ...(withBase && this.baseState && { baseEncodedState: this.baseState }),
    }
  }

  private async rebaseStored(stored: CollaborationSnapshot) {
    if (!stored.baseEncodedState) return false
    return this.rebaseOntoCanonical({
      localState: stored.encodedState,
      baseState: stored.baseEncodedState,
      canonicalState: Y.encodeStateAsUpdate(this.options.document),
      bodyVersion: this.options.bodyVersion,
      bodyEpoch: this.options.bodyEpoch,
      bodySchemaVersion: this.options.bodySchemaVersion,
      canEdit: this.canEdit === true,
    })
  }

  // Epoch changed while edits were pending. Merge them onto the canonical body
  // by node ID; anything that cannot merge safely falls back to review.
  private async rebaseOnline() {
    if (this.rebasing) return
    this.rebasing = true
    try {
      const body = this.options.refreshCanonicalBody
        ? await this.options.refreshCanonicalBody()
        : await getMarkdownBody(
            this.options.workspaceID,
            this.options.documentID
          )
      if (
        body.bodyEpoch > this.options.bodyEpoch &&
        body.bodySchemaVersion === this.options.bodySchemaVersion &&
        this.baseState &&
        (await this.rebaseOntoCanonical({
          localState: Y.encodeStateAsUpdate(this.options.document),
          baseState: this.baseState,
          canonicalState: decodeBase64(body.encodedState),
          bodyVersion: body.bodyVersion,
          bodyEpoch: body.bodyEpoch,
          bodySchemaVersion: body.bodySchemaVersion,
          canEdit: body.canEdit,
        }))
      )
        return
    } catch {
      // Fall through to review; pending edits are untouched.
    } finally {
      this.rebasing = false
    }
    if (!this.stopped && !this.terminal) this.requireRecovery('epoch-changed')
  }

  private async rebaseOntoCanonical(input: {
    localState: Uint8Array
    baseState: Uint8Array
    canonicalState: Uint8Array
    bodyVersion: number
    bodyEpoch: number
    bodySchemaVersion: number
    canEdit: boolean
  }): Promise<boolean> {
    if (this.stopped || this.terminal || this.storageFailed) return false
    try {
      const canonicalNodes = projectState(input.canonicalState)
      const { nodes, conflicts, applied, held } = rebasePendingEdits({
        base: projectState(input.baseState),
        local: projectState(input.localState),
        canonical: canonicalNodes,
      })
      // All-or-nothing only when nothing merged cleanly; otherwise apply the
      // clean part and hold just the conflicting nodes for review.
      if (conflicts.length && applied === 0) return false
      const update = buildRebaseUpdate(input.canonicalState, nodes)
      const encodedState = Y.mergeUpdates([input.canonicalState, update])
      const rebased: CollaborationSnapshot = {
        bodyVersion: input.bodyVersion,
        bodyEpoch: input.bodyEpoch,
        bodySchemaVersion: input.bodySchemaVersion,
        canEdit: input.canEdit,
        encodedState,
        baseEncodedState: input.canonicalState,
      }
      const previouslyHeld = (await this.store.load(this.scope)).heldEdits
      const allHeld = [
        ...previouslyHeld.filter(
          (edit) => !held.some((next) => next.nodeID === edit.nodeID)
        ),
        ...held,
      ]
      await this.enqueueStorage(() =>
        this.store.replaceWithRebased(
          this.scope,
          rebased,
          {
            updateID: crypto.randomUUID(),
            bodyEpoch: input.bodyEpoch,
            bodySchemaVersion: input.bodySchemaVersion,
            update,
          },
          allHeld
        )
      )
      if (this.storageFailed || this.stopped) return true
      if (allHeld.length) this.options.onHeldEdits?.(allHeld)
      const root = nodes.find((node) => node.parentID === null)!
      this.pending.clear()
      this.baseState = undefined
      this.terminal = true
      this.ready = false
      this.options.document.off('update', this.handleYUpdate)
      this.socket?.close()
      this.setStatus('closed')
      this.options.onCanonicalBody?.({
        bodyVersion: input.bodyVersion,
        bodyEpoch: input.bodyEpoch,
        bodySchemaVersion: input.bodySchemaVersion,
        canEdit: input.canEdit,
        rootNodeID: root.nodeID,
        nodes: nodes.map((node) => ({ ...node, version: 1 })),
        encodedState: encodeBase64(encodedState),
      })
      return true
    } catch {
      return false
    }
  }

  private enqueueStorage(operation: () => Promise<void>) {
    this.storageQueue = this.storageQueue
      .then(() => operation())
      .catch(() => this.failStorage())
    return this.storageQueue
  }

  private failStorage() {
    this.storageFailed = true
    this.ready = false
    this.terminal = true
    this.options.document.off('update', this.handleYUpdate)
    this.setStatus('storage-error')
    this.socket?.close()
  }

  private disconnected() {
    this.options.onPresence?.([])
    this.remoteCursors.clear()
    this.options.onRemoteCursors?.([])
    if (this.stopped || this.terminal || this.storageFailed) return
    this.ready = false
    this.sentThisConnection.clear()
    this.batches.clear()
    this.lastBatchSentAt = 0
    if (this.batchTimer) clearTimeout(this.batchTimer)
    this.batchTimer = undefined
    this.setStatus('offline')
    this.scheduleReconnect()
  }

  private scheduleReconnect() {
    if (
      this.stopped ||
      this.terminal ||
      this.storageFailed ||
      this.reconnectTimer
    )
      return
    const delay = Math.min(250 * 2 ** this.reconnectAttempt, 15_000)
    this.reconnectAttempt++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.connect()
    }, delay)
  }

  private setStatus(status: CollaborativeDocumentStatus) {
    if (this.status === status) return
    this.status = status
    this.options.onStatus?.(status)
  }
}

export async function executeDeleteNode(
  workspaceID: string,
  documentID: string,
  command: PendingDeleteNodeCommand
) {
  const receipt = await deleteMarkdownNode(workspaceID, documentID, command)
  const targets = deleteTargets(command)
  const answered = receipt.nodeIDs ?? (receipt.nodeID ? [receipt.nodeID] : [])
  if (
    receipt.commandID !== command.commandID ||
    answered.length !== targets.length ||
    answered.some((id, index) => id !== targets[index])
  )
    throw new Error('DeleteNode receipt does not match the pending command')
  const body = await getMarkdownBody(workspaceID, documentID)
  if (body.bodyEpoch < receipt.bodyEpoch)
    throw new Error('canonical body is older than the DeleteNode receipt')
  return body
}

export async function executeMoveNode(
  workspaceID: string,
  documentID: string,
  command: PendingMoveNodeCommand
) {
  const receipt = await moveMarkdownNode(workspaceID, documentID, command)
  if (receipt.commandID !== command.commandID)
    throw new Error('MoveNode receipt does not match the pending command')
  const body = await getMarkdownBody(workspaceID, documentID)
  if (body.bodyEpoch < receipt.bodyEpoch)
    throw new Error('canonical body is older than the MoveNode receipt')
  return body
}

function projectState(state: Uint8Array): DocumentBodyNode[] {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, state)
    return prosemirrorToDocumentBody(
      yXmlFragmentToProseMirrorRootNode(
        doc.getXmlFragment('body'),
        documentBodySchema
      )
    )
  } finally {
    doc.destroy()
  }
}

type StructuralNode = { nodeID: string; parentID: string | null }

function deleteStillMakesSense(
  nodes: StructuralNode[],
  nodeIDs: string[]
): 'done' | 'reissue' | 'unsafe' {
  const targets = nodeIDs
    .map((nodeID) => nodes.find((candidate) => candidate.nodeID === nodeID))
    .filter((node): node is StructuralNode => node !== undefined)
  if (!targets.length) return 'done'
  return targets.some((node) => node.parentID === null) ? 'unsafe' : 'reissue'
}

function moveStillMakesSense(
  nodes: StructuralNode[],
  move: PendingMoveNodeCommand
): 'reissue' | 'unsafe' {
  const byID = new Map(nodes.map((node) => [node.nodeID, node]))
  const node = byID.get(move.nodeID)
  const target = byID.get(move.targetParentID)
  if (!node || !target || node.parentID === null) return 'unsafe'
  for (
    let ancestor: StructuralNode | undefined = target;
    ancestor;
    ancestor = ancestor.parentID ? byID.get(ancestor.parentID) : undefined
  )
    if (ancestor.nodeID === node.nodeID) return 'unsafe'
  if (move.beforeNodeID != null) {
    const before = byID.get(move.beforeNodeID)
    if (!before || before.parentID !== move.targetParentID) return 'unsafe'
  }
  return 'reissue'
}

function subtreeOf<T extends DocumentBodyNode>(nodes: T[], rootID: string) {
  const children = new Map<string, T[]>()
  for (const node of nodes) {
    if (node.parentID === null) continue
    children.set(node.parentID, [...(children.get(node.parentID) ?? []), node])
  }
  const subtree = new Map<string, T>()
  const pending = nodes.filter((node) => node.nodeID === rootID)
  while (pending.length) {
    const node = pending.pop()!
    subtree.set(node.nodeID, node)
    pending.push(...(children.get(node.nodeID) ?? []))
  }
  return subtree
}

function sameSubtree(
  seen: DocumentBodyNode[],
  current: DocumentBodyNode[],
  rootID: string
) {
  const before = subtreeOf(seen, rootID)
  const after = subtreeOf(current, rootID)
  if (before.size === 0 || before.size !== after.size) return false
  for (const [nodeID, node] of before) {
    const other = after.get(nodeID)
    if (
      !other ||
      other.parentID !== node.parentID ||
      other.type !== node.type ||
      other.content !== node.content ||
      JSON.stringify(other.attributes) !== JSON.stringify(node.attributes)
    )
      return false
  }
  return true
}
