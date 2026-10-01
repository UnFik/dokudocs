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
    update: PendingCollaborationUpdate
  ): Promise<void>
  clear(scope: CollaborationScope): Promise<void>
}

type SnapshotRow = CollaborationSnapshot & { scope: string }
type UpdateRow = PendingCollaborationUpdate & { key: string; scope: string }
type DeleteCommandRow = PendingDeleteNodeCommand & {
  key: string
  scope: string
}
type MoveCommandRow = PendingMoveNodeCommand & { key: string; scope: string }

const databaseName = 'dokudocs-collaboration'
const databaseVersion = 3
const snapshotStore = 'snapshots'
const updateStore = 'pending-updates'
const deleteCommandStore = 'pending-delete-commands'
const moveCommandStore = 'pending-move-commands'

export class IndexedDBCollaborationStore implements CollaborationStore {
  private database?: Promise<IDBDatabase>

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  async load(scope: CollaborationScope): Promise<CollaborationStoreContents> {
    const db = await this.open()
    const key = scopeKey(scope)
    return transaction(
      db,
      [snapshotStore, updateStore, deleteCommandStore, moveCommandStore],
      'readonly',
      async (tx) => {
        const snapshots = tx.objectStore(snapshotStore)
        const updates = tx.objectStore(updateStore)
        const commands = tx.objectStore(deleteCommandStore)
        const moves = tx.objectStore(moveCommandStore)
        const [snapshot, rows, commandRows, moveRows] = await Promise.all([
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
        ])
        return {
          snapshot: snapshot ? copySnapshot(snapshot) : null,
          updates: rows.map(copyUpdate),
          deleteCommands: commandRows.map(copyDeleteCommand),
          moveCommands: moveRows.map(copyMoveCommand),
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
      const updates = tx.objectStore(updateStore)
      // The cursor delete is asynchronous; insert the rebased row only after it
      // finishes so the cursor cannot delete it.
      const cursor = updates.index('scope').openKeyCursor(IDBKeyRange.only(key))
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
    })
  }

  async clear(scope: CollaborationScope): Promise<void> {
    const db = await this.open()
    const key = scopeKey(scope)
    await transaction(
      db,
      [snapshotStore, updateStore, deleteCommandStore, moveCommandStore],
      'readwrite',
      (tx) => {
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

  /** Documents of one user that still hold unsynced updates or commands. */
  async listPendingDocuments(
    userID: string
  ): Promise<{ documentID: string; count: number }[]> {
    if (!userID) throw new Error('collaboration storage scope is required')
    const db = await this.open()
    const prefix = `${userID}:`
    const rows = await transaction(
      db,
      [updateStore, deleteCommandStore, moveCommandStore],
      'readonly',
      (tx) =>
        Promise.all(
          [updateStore, deleteCommandStore, moveCommandStore].map((name) =>
            requestValue(
              tx.objectStore(name).getAll() as IDBRequest<{ scope: string }[]>
            )
          )
        )
    )
    const counts = new Map<string, number>()
    for (const row of rows.flat()) {
      if (!row.scope.startsWith(prefix)) continue
      const documentID = row.scope.slice(prefix.length)
      counts.set(documentID, (counts.get(documentID) ?? 0) + 1)
    }
    return [...counts].map(([documentID, count]) => ({ documentID, count }))
  }

  /** Every document of one user that has anything cached, pending or not. */
  async listAllDocuments(userID: string): Promise<string[]> {
    if (!userID) throw new Error('collaboration storage scope is required')
    const db = await this.open()
    const prefix = `${userID}:`
    const keys = await transaction(db, [snapshotStore], 'readonly', (tx) =>
      requestValue(tx.objectStore(snapshotStore).getAllKeys())
    )
    return keys
      .filter((key): key is string => typeof key === 'string')
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
  }

  /** Removes every cached body, pending update, and command of one user. */
  async clearUser(userID: string): Promise<void> {
    if (!userID) throw new Error('collaboration storage scope is required')
    const db = await this.open()
    const prefix = `${userID}:`
    await transaction(
      db,
      [snapshotStore, updateStore, deleteCommandStore, moveCommandStore],
      'readwrite',
      (tx) => {
        for (const name of [
          snapshotStore,
          updateStore,
          deleteCommandStore,
          moveCommandStore,
        ]) {
          const store = tx.objectStore(name)
          const cursor = store.openCursor()
          cursor.onsuccess = () => {
            const current = cursor.result
            if (!current) return
            if ((current.value as { scope: string }).scope.startsWith(prefix))
              current.delete()
            current.continue()
          }
        }
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
