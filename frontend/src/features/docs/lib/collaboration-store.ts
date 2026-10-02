import type { HeldEdit } from './collaboration-rebase'

export type CollaborationScope = {
  userID: string
  documentID: string
}

export type CollaborationSnapshot = {
  bodyVersion: number
  bodyEpoch: number
  bodySchemaVersion: number
  canEdit?: boolean
  encodedState: Uint8Array
  /** Server state the pending updates started from; enables nodeID rebase. */
  baseEncodedState?: Uint8Array
}

export type PendingCollaborationUpdate = {
  updateID: string
  bodyEpoch: number
  bodySchemaVersion: number
  update: Uint8Array
}

export type PendingDeleteNodeCommand = {
  commandID: string
  bodyEpoch: number
  bodySchemaVersion: number
  nodeID: string
}

export type PendingMoveNodeCommand = {
  commandID: string
  bodyEpoch: number
  bodySchemaVersion: number
  nodeID: string
  targetParentID: string
  beforeNodeID: string | null
}

export type CollaborationStoreContents = {
  snapshot: CollaborationSnapshot | null
  updates: PendingCollaborationUpdate[]
  deleteCommands: PendingDeleteNodeCommand[]
  moveCommands: PendingMoveNodeCommand[]
  /** Edits a partial rebase left out because they conflicted; kept for review. */
  heldEdits: HeldEdit[]
}

export interface CollaborationStore {
  load(scope: CollaborationScope): Promise<CollaborationStoreContents>
  saveSnapshot(
    scope: CollaborationScope,
    snapshot: CollaborationSnapshot
  ): Promise<void>
  saveUpdate(
    scope: CollaborationScope,
    snapshot: CollaborationSnapshot,
    update: PendingCollaborationUpdate
  ): Promise<void>
  acknowledge(
    scope: CollaborationScope,
    updateID: string,
    snapshot: CollaborationSnapshot
  ): Promise<void>
  /** Removes several acknowledged updates and saves the snapshot atomically. */
  acknowledgeMany(
    scope: CollaborationScope,
    updateIDs: string[],
    snapshot: CollaborationSnapshot
  ): Promise<void>
  saveDeleteCommand(
    scope: CollaborationScope,
    snapshot: CollaborationSnapshot,
    command: PendingDeleteNodeCommand
  ): Promise<void>
  /** Atomically swaps a stale-epoch DeleteNode for one re-issued at the new epoch. */
  replaceDeleteCommand(
    scope: CollaborationScope,
    snapshot: CollaborationSnapshot,
    oldCommandID: string,
    command: PendingDeleteNodeCommand
  ): Promise<void>
  replaceMoveCommand(
    scope: CollaborationScope,
    snapshot: CollaborationSnapshot,
    oldCommandID: string,
    command: PendingMoveNodeCommand
  ): Promise<void>
  completeDeleteCommand(
    scope: CollaborationScope,
    commandID: string,
    snapshot: CollaborationSnapshot
  ): Promise<void>
  saveMoveCommand(
    scope: CollaborationScope,
    snapshot: CollaborationSnapshot,
    command: PendingMoveNodeCommand
  ): Promise<void>
  completeMoveCommand(
    scope: CollaborationScope,
    commandID: string,
    snapshot: CollaborationSnapshot
  ): Promise<void>
  /**
   * Atomically swaps the stored state for a newer canonical epoch plus the
   * rebased copy of the pending edits, dropping the old-epoch pending updates.
   */
  replaceWithRebased(
    scope: CollaborationScope,
    snapshot: CollaborationSnapshot,
    update: PendingCollaborationUpdate,
    heldEdits?: HeldEdit[]
  ): Promise<void>
  clearHeldEdits(scope: CollaborationScope): Promise<void>
  /** Replaces the held edits; an empty list clears them. */
  setHeldEdits(scope: CollaborationScope, edits: HeldEdit[]): Promise<void>
  clear(scope: CollaborationScope): Promise<void>
}

type SnapshotRow = CollaborationSnapshot & { scope: string }
type UpdateRow = PendingCollaborationUpdate & { key: string; scope: string }
type DeleteCommandRow = PendingDeleteNodeCommand & {
  key: string
  scope: string
}
type MoveCommandRow = PendingMoveNodeCommand & { key: string; scope: string }
type HeldEditRow = { scope: string; edits: HeldEdit[] }

const databaseName = 'dokudocs-collaboration'
const databaseVersion = 4
const snapshotStore = 'snapshots'
const updateStore = 'pending-updates'
const deleteCommandStore = 'pending-delete-commands'
const moveCommandStore = 'pending-move-commands'
const heldEditStore = 'held-edits'

export class IndexedDBCollaborationStore implements CollaborationStore {
  private database?: Promise<IDBDatabase>

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  async load(scope: CollaborationScope): Promise<CollaborationStoreContents> {
    const db = await this.open()
    const key = scopeKey(scope)
    return transaction(
      db,
      [
        snapshotStore,
        updateStore,
        deleteCommandStore,
        moveCommandStore,
        heldEditStore,
      ],
      'readonly',
      async (tx) => {
        const snapshots = tx.objectStore(snapshotStore)
        const updates = tx.objectStore(updateStore)
        const commands = tx.objectStore(deleteCommandStore)
        const moves = tx.objectStore(moveCommandStore)
        const [snapshot, rows, commandRows, moveRows, held] = await Promise.all(
          [
            requestValue(
              snapshots.get(key) as IDBRequest<SnapshotRow | undefined>
            ),
            requestValue(
              updates.index('scope').getAll(key) as IDBRequest<UpdateRow[]>
            ),
            requestValue(
              commands.index('scope').getAll(key) as IDBRequest<
                DeleteCommandRow[]
              >
            ),
            requestValue(
              moves.index('scope').getAll(key) as IDBRequest<MoveCommandRow[]>
            ),
            requestValue(
              tx.objectStore(heldEditStore).get(key) as IDBRequest<
                HeldEditRow | undefined
              >
            ),
          ]
        )
        return {
          snapshot: snapshot ? copySnapshot(snapshot) : null,
          updates: rows.map(copyUpdate),
          deleteCommands: commandRows.map(copyDeleteCommand),
          moveCommands: moveRows.map(copyMoveCommand),
          heldEdits: held ? structuredClone(held.edits) : [],
        }
      }
    )
  }

  async saveSnapshot(
    scope: CollaborationScope,
    snapshot: CollaborationSnapshot
  ): Promise<void> {
    const db = await this.open()
    await transaction(db, [snapshotStore], 'readwrite', (tx) => {
      tx.objectStore(snapshotStore).put({
        ...snapshot,
        canEdit: snapshot.canEdit === true,
        encodedState: snapshot.encodedState.slice(),
        scope: scopeKey(scope),
      } satisfies SnapshotRow)
    })
  }

  async saveUpdate(
    scope: CollaborationScope,
    snapshot: CollaborationSnapshot,
    update: PendingCollaborationUpdate
  ): Promise<void> {
    const db = await this.open()
    const key = scopeKey(scope)
    await transaction(db, [snapshotStore, updateStore], 'readwrite', (tx) => {
      tx.objectStore(snapshotStore).put({
        ...snapshot,
        canEdit: snapshot.canEdit === true,
        encodedState: snapshot.encodedState.slice(),
        scope: key,
      } satisfies SnapshotRow)
      tx.objectStore(updateStore).put({
        ...update,
        update: update.update.slice(),
        key: updateKey(key, update.updateID),
        scope: key,
      } satisfies UpdateRow)
    })
  }

  async acknowledge(
    scope: CollaborationScope,
    updateID: string,
    snapshot: CollaborationSnapshot
  ): Promise<void> {
    const db = await this.open()
    const key = scopeKey(scope)
    await transaction(db, [snapshotStore, updateStore], 'readwrite', (tx) => {
      tx.objectStore(snapshotStore).put({
        ...snapshot,
        canEdit: snapshot.canEdit === true,
        encodedState: snapshot.encodedState.slice(),
        scope: key,
      } satisfies SnapshotRow)
      tx.objectStore(updateStore).delete(updateKey(scopeKey(scope), updateID))
    })
  }

  async acknowledgeMany(
    scope: CollaborationScope,
    updateIDs: string[],
    snapshot: CollaborationSnapshot
  ): Promise<void> {
    const db = await this.open()
    const key = scopeKey(scope)
    await transaction(db, [snapshotStore, updateStore], 'readwrite', (tx) => {
      tx.objectStore(snapshotStore).put({
        ...snapshot,
        canEdit: snapshot.canEdit === true,
        encodedState: snapshot.encodedState.slice(),
        scope: key,
      } satisfies SnapshotRow)
      const updates = tx.objectStore(updateStore)
      for (const updateID of updateIDs) updates.delete(updateKey(key, updateID))
    })
  }

  async saveDeleteCommand(
    scope: CollaborationScope,
    snapshot: CollaborationSnapshot,
    command: PendingDeleteNodeCommand
  ): Promise<void> {
    const db = await this.open()
    const key = scopeKey(scope)
    await transaction(
      db,
      [snapshotStore, deleteCommandStore],
      'readwrite',
      (tx) => {
        tx.objectStore(snapshotStore).put(snapshotRow(key, snapshot))
        tx.objectStore(deleteCommandStore).put({
          ...command,
          key: deleteCommandKey(key, command.commandID),
          scope: key,
        } satisfies DeleteCommandRow)
      }
    )
  }

  async replaceDeleteCommand(
    scope: CollaborationScope,
    snapshot: CollaborationSnapshot,
    oldCommandID: string,
    command: PendingDeleteNodeCommand
  ): Promise<void> {
    const db = await this.open()
    const key = scopeKey(scope)
    await transaction(
      db,
      [snapshotStore, deleteCommandStore],
      'readwrite',
      (tx) => {
        tx.objectStore(snapshotStore).put(snapshotRow(key, snapshot))
        const commands = tx.objectStore(deleteCommandStore)
        commands.delete(deleteCommandKey(key, oldCommandID))
        commands.put({
          ...command,
          key: deleteCommandKey(key, command.commandID),
          scope: key,
        } satisfies DeleteCommandRow)
      }
    )
  }

  async replaceMoveCommand(
    scope: CollaborationScope,
    snapshot: CollaborationSnapshot,
    oldCommandID: string,
    command: PendingMoveNodeCommand
  ): Promise<void> {
    const db = await this.open()
    const key = scopeKey(scope)
    await transaction(
      db,
      [snapshotStore, moveCommandStore],
      'readwrite',
      (tx) => {
        tx.objectStore(snapshotStore).put(snapshotRow(key, snapshot))
        const commands = tx.objectStore(moveCommandStore)
        commands.delete(moveCommandKey(key, oldCommandID))
        commands.put({
          ...command,
          key: moveCommandKey(key, command.commandID),
          scope: key,
        } satisfies MoveCommandRow)
      }
    )
  }

  async completeDeleteCommand(
    scope: CollaborationScope,
    commandID: string,
    snapshot: CollaborationSnapshot
  ): Promise<void> {
    const db = await this.open()
    const key = scopeKey(scope)
    await transaction(
      db,
      [snapshotStore, deleteCommandStore],
      'readwrite',
      (tx) => {
        tx.objectStore(snapshotStore).put(snapshotRow(key, snapshot))
        tx.objectStore(deleteCommandStore).delete(
          deleteCommandKey(key, commandID)
        )
      }
    )
  }

  async saveMoveCommand(
    scope: CollaborationScope,
    snapshot: CollaborationSnapshot,
    command: PendingMoveNodeCommand
  ): Promise<void> {
    const db = await this.open()
    const key = scopeKey(scope)
    await transaction(
      db,
      [snapshotStore, moveCommandStore],
      'readwrite',
      (tx) => {
        tx.objectStore(snapshotStore).put(snapshotRow(key, snapshot))
        tx.objectStore(moveCommandStore).put({
          ...command,
          key: moveCommandKey(key, command.commandID),
          scope: key,
        } satisfies MoveCommandRow)
      }
    )
  }

  async completeMoveCommand(
    scope: CollaborationScope,
    commandID: string,
    snapshot: CollaborationSnapshot
  ): Promise<void> {
    const db = await this.open()
    const key = scopeKey(scope)
    await transaction(
      db,
      [snapshotStore, moveCommandStore],
      'readwrite',
      (tx) => {
        tx.objectStore(snapshotStore).put(snapshotRow(key, snapshot))
        tx.objectStore(moveCommandStore).delete(moveCommandKey(key, commandID))
      }
    )
  }

  async replaceWithRebased(
    scope: CollaborationScope,
    snapshot: CollaborationSnapshot,
    update: PendingCollaborationUpdate,
    heldEdits: HeldEdit[] = []
  ): Promise<void> {
    const db = await this.open()
    const key = scopeKey(scope)
    await transaction(
      db,
      [snapshotStore, updateStore, heldEditStore],
      'readwrite',
      (tx) => {
        if (heldEdits.length)
          tx.objectStore(heldEditStore).put({
            scope: key,
            edits: structuredClone(heldEdits),
          } satisfies HeldEditRow)
        tx.objectStore(snapshotStore).put({
          ...snapshot,
          canEdit: snapshot.canEdit === true,
          encodedState: snapshot.encodedState.slice(),
          scope: key,
        } satisfies SnapshotRow)
        const updates = tx.objectStore(updateStore)
        // The cursor delete is asynchronous; insert the rebased row only after it
        // finishes so the cursor cannot delete it.
        const cursor = updates
          .index('scope')
          .openKeyCursor(IDBKeyRange.only(key))
        cursor.onsuccess = () => {
          const current = cursor.result
          if (current) {
            updates.delete(current.primaryKey)
            current.continue()
            return
          }
          updates.put({
            ...update,
            update: update.update.slice(),
            key: updateKey(key, update.updateID),
            scope: key,
          } satisfies UpdateRow)
        }
      }
    )
  }

  async setHeldEdits(
    scope: CollaborationScope,
    edits: HeldEdit[]
  ): Promise<void> {
    const db = await this.open()
    const key = scopeKey(scope)
    await transaction(db, [heldEditStore], 'readwrite', (tx) => {
      const store = tx.objectStore(heldEditStore)
      if (edits.length)
        store.put({
          scope: key,
          edits: structuredClone(edits),
        } satisfies HeldEditRow)
      else store.delete(key)
    })
  }

  async clearHeldEdits(scope: CollaborationScope): Promise<void> {
    const db = await this.open()
    await transaction(db, [heldEditStore], 'readwrite', (tx) => {
      tx.objectStore(heldEditStore).delete(scopeKey(scope))
    })
  }

  async clear(scope: CollaborationScope): Promise<void> {
    const db = await this.open()
    const key = scopeKey(scope)
    await transaction(
      db,
      [
        snapshotStore,
        updateStore,
        deleteCommandStore,
        moveCommandStore,
        heldEditStore,
      ],
      'readwrite',
      (tx) => {
        tx.objectStore(heldEditStore).delete(key)
        const snapshots = tx.objectStore(snapshotStore)
        const updates = tx.objectStore(updateStore)
        const commands = tx.objectStore(deleteCommandStore)
        const moves = tx.objectStore(moveCommandStore)
        snapshots.delete(key)
        deleteScopeRows(updates, key)
        deleteScopeRows(commands, key)
        deleteScopeRows(moves, key)
      }
    )
  }

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.factory.open(databaseName, databaseVersion)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(snapshotStore))
            db.createObjectStore(snapshotStore, { keyPath: 'scope' })
          if (!db.objectStoreNames.contains(updateStore)) {
            const updates = db.createObjectStore(updateStore, {
              keyPath: 'key',
            })
            updates.createIndex('scope', 'scope')
          }
          if (!db.objectStoreNames.contains(deleteCommandStore)) {
            const commands = db.createObjectStore(deleteCommandStore, {
              keyPath: 'key',
            })
            commands.createIndex('scope', 'scope')
          }
          if (!db.objectStoreNames.contains(heldEditStore))
            db.createObjectStore(heldEditStore, { keyPath: 'scope' })
          if (!db.objectStoreNames.contains(moveCommandStore)) {
            const commands = db.createObjectStore(moveCommandStore, {
              keyPath: 'key',
            })
            commands.createIndex('scope', 'scope')
          }
        }
        request.onerror = () => reject(request.error)
        request.onblocked = () =>
          reject(new Error('collaboration database is blocked'))
        request.onsuccess = () => {
          const db = request.result
          db.onversionchange = () => {
            db.close()
            this.database = undefined
          }
          resolve(db)
        }
      }).catch((error: unknown) => {
        this.database = undefined
        throw error
      })
    }
    return this.database
  }
}

export async function hasOfflineMarkdownBody(scope: CollaborationScope) {
  const stored = await new IndexedDBCollaborationStore().load(scope)
  return Boolean(
    stored.snapshot?.encodedState.byteLength &&
    stored.snapshot.bodySchemaVersion === 1
  )
}

function scopeKey(scope: CollaborationScope) {
  if (!scope.userID || !scope.documentID)
    throw new Error('collaboration storage scope is required')
  return `${scope.userID}:${scope.documentID}`
}

function updateKey(scope: string, updateID: string) {
  if (!updateID) throw new Error('update ID is required')
  return `${scope}:${updateID}`
}

function copySnapshot(row: SnapshotRow): CollaborationSnapshot {
  return {
    bodyVersion: row.bodyVersion,
    bodyEpoch: row.bodyEpoch,
    bodySchemaVersion: row.bodySchemaVersion,
    canEdit: row.canEdit === true,
    encodedState: row.encodedState.slice(),
    ...(row.baseEncodedState && {
      baseEncodedState: row.baseEncodedState.slice(),
    }),
  }
}

function copyUpdate(row: UpdateRow): PendingCollaborationUpdate {
  return {
    updateID: row.updateID,
    bodyEpoch: row.bodyEpoch,
    bodySchemaVersion: row.bodySchemaVersion,
    update: row.update.slice(),
  }
}

function copyDeleteCommand(row: DeleteCommandRow): PendingDeleteNodeCommand {
  return {
    commandID: row.commandID,
    bodyEpoch: row.bodyEpoch,
    bodySchemaVersion: row.bodySchemaVersion,
    nodeID: row.nodeID,
  }
}

function copyMoveCommand(row: MoveCommandRow): PendingMoveNodeCommand {
  return {
    commandID: row.commandID,
    bodyEpoch: row.bodyEpoch,
    bodySchemaVersion: row.bodySchemaVersion,
    nodeID: row.nodeID,
    targetParentID: row.targetParentID,
    beforeNodeID: row.beforeNodeID,
  }
}

function snapshotRow(
  scope: string,
  snapshot: CollaborationSnapshot
): SnapshotRow {
  return {
    ...snapshot,
    canEdit: snapshot.canEdit === true,
    encodedState: snapshot.encodedState.slice(),
    scope,
  }
}

function deleteCommandKey(scope: string, commandID: string) {
  if (!commandID) throw new Error('command ID is required')
  return `${scope}:${commandID}`
}

function moveCommandKey(scope: string, commandID: string) {
  if (!commandID) throw new Error('command ID is required')
  return `${scope}:${commandID}`
}

function deleteScopeRows(store: IDBObjectStore, scope: string) {
  const cursor = store.index('scope').openKeyCursor(IDBKeyRange.only(scope))
  cursor.onsuccess = () => {
    const current = cursor.result
    if (current) {
      store.delete(current.primaryKey)
      current.continue()
    }
  }
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transaction<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => T | Promise<T>
): Promise<T> {
  const tx = db.transaction(stores, mode)
  const completed = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () =>
      reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
  try {
    const result = await work(tx)
    await completed
    return result
  } catch (error) {
    try {
      tx.abort()
    } catch {
      // The transaction may already have aborted or completed.
    }
    await completed.catch(() => undefined)
    throw error
  }
}
