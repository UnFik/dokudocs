import { describe, expect, it, vi } from 'vitest'
import {
  prosemirrorToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror'
import * as Y from 'yjs'
import { ApiError } from '@/lib/api-client'
import { CollaborativeDocumentProvider } from './collaboration-provider'
import type { HeldEdit } from './collaboration-rebase'
import type {
  CollaborationScope,
  CollaborationSnapshot,
  CollaborationStore,
  CollaborationStoreContents,
  PendingDeleteNodeCommand,
  PendingMoveNodeCommand,
  PendingCollaborationUpdate,
} from './collaboration-store'
import type { DocumentBodyNode } from './documentBody'
import {
  documentBodySchema,
  documentBodyToProseMirror,
  prosemirrorToDocumentBody,
} from './prosemirror/documentBody'

class FakeSocket extends EventTarget {
  readyState = 0
  sent: string[] = []

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }

  open() {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }

  receive(message: unknown) {
    this.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify(message) })
    )
  }
}

class MemoryStore implements CollaborationStore {
  snapshot: CollaborationSnapshot | null = null
  updates = new Map<string, PendingCollaborationUpdate>()
  deleteCommands = new Map<string, PendingDeleteNodeCommand>()
  moveCommands = new Map<string, PendingMoveNodeCommand>()
  heldEdits: HeldEdit[] = []
  beforeSaveSnapshot?: Promise<void>
  beforeSaveUpdate?: Promise<void>

  async load(_scope: CollaborationScope): Promise<CollaborationStoreContents> {
    return {
      snapshot: this.snapshot,
      updates: [...this.updates.values()],
      deleteCommands: [...this.deleteCommands.values()],
      moveCommands: [...this.moveCommands.values()],
      heldEdits: this.heldEdits,
    }
  }

  async saveSnapshot(
    _scope: CollaborationScope,
    snapshot: CollaborationSnapshot
  ) {
    await this.beforeSaveSnapshot
    this.snapshot = snapshot
  }

  async saveUpdate(
    _scope: CollaborationScope,
    snapshot: CollaborationSnapshot,
    update: PendingCollaborationUpdate
  ) {
    await this.beforeSaveUpdate
    this.snapshot = snapshot
    this.updates.set(update.updateID, update)
  }

  async acknowledge(
    _scope: CollaborationScope,
    updateID: string,
    snapshot: CollaborationSnapshot
  ) {
    this.snapshot = snapshot
    this.updates.delete(updateID)
  }

  async acknowledgeMany(
    _scope: CollaborationScope,
    updateIDs: string[],
    snapshot: CollaborationSnapshot
  ) {
    this.snapshot = snapshot
    for (const updateID of updateIDs) this.updates.delete(updateID)
  }

  async saveDeleteCommand(
    _scope: CollaborationScope,
    snapshot: CollaborationSnapshot,
    command: PendingDeleteNodeCommand
  ) {
    this.snapshot = snapshot
    this.deleteCommands.set(command.commandID, command)
  }

  async replaceDeleteCommand(
    _scope: CollaborationScope,
    snapshot: CollaborationSnapshot,
    oldCommandID: string,
    command: PendingDeleteNodeCommand
  ) {
    this.snapshot = snapshot
    this.deleteCommands.delete(oldCommandID)
    this.deleteCommands.set(command.commandID, command)
  }

  async replaceMoveCommand(
    _scope: CollaborationScope,
    snapshot: CollaborationSnapshot,
    oldCommandID: string,
    command: PendingMoveNodeCommand
  ) {
    this.snapshot = snapshot
    this.moveCommands.delete(oldCommandID)
    this.moveCommands.set(command.commandID, command)
  }

  async completeDeleteCommand(
    _scope: CollaborationScope,
    commandID: string,
    snapshot: CollaborationSnapshot
  ) {
    this.snapshot = snapshot
    this.deleteCommands.delete(commandID)
  }

  async saveMoveCommand(
    _scope: CollaborationScope,
    snapshot: CollaborationSnapshot,
    command: PendingMoveNodeCommand
  ) {
    this.snapshot = snapshot
    this.moveCommands.set(command.commandID, command)
  }

  async completeMoveCommand(
    _scope: CollaborationScope,
    commandID: string,
    snapshot: CollaborationSnapshot
  ) {
    this.snapshot = snapshot
    this.moveCommands.delete(commandID)
  }

  async replaceWithRebased(
    _scope: CollaborationScope,
    snapshot: CollaborationSnapshot,
    update: PendingCollaborationUpdate,
    heldEdits: HeldEdit[] = []
  ) {
    this.snapshot = snapshot
    this.heldEdits = heldEdits
    this.updates.clear()
    this.updates.set(update.updateID, update)
  }

  async setHeldEdits(_scope: CollaborationScope, edits: HeldEdit[]) {
    this.heldEdits = edits
  }

  async clearHeldEdits(_scope: CollaborationScope) {
    this.heldEdits = []
  }

  async clear(_scope: CollaborationScope) {
    this.heldEdits = []
    this.snapshot = null
    this.updates.clear()
    this.deleteCommands.clear()
    this.moveCommands.clear()
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function base64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function wait(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

describe('CollaborativeDocumentProvider', () => {
  it('persists local Yjs updates before sending and removes them after ACK', async () => {
    const serverDoc = new Y.Doc()
    serverDoc.getText('body').insert(0, 'base')
    const initialState = Y.encodeStateAsUpdate(serverDoc)
    const document = new Y.Doc()
    Y.applyUpdate(document, initialState)

    const store = new MemoryStore()
    const saveGate = deferred()
    store.beforeSaveUpdate = saveGate.promise
    const socket = new FakeSocket()
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      baseURL: 'https://docs.example.test',
      store,
      socketFactory: () => socket,
    })

    await provider.start()
    socket.open()
    socket.receive({
      type: 'ready',
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      canEdit: true,
      state: base64(initialState),
    })
    await flushPromises()
    expect(document.getText('body').toString()).toBe('base')

    document.getText('body').insert(4, '!')
    await flushPromises()
    expect(socket.sent).toHaveLength(1)
    expect(store.updates.size).toBe(0)

    saveGate.resolve()
    await flushPromises()
    expect(socket.sent).toHaveLength(2)
    const updateFrame = JSON.parse(socket.sent[1]!) as {
      type: string
      updateID: string
      update: string
    }
    expect(updateFrame.type).toBe('update')
    expect(store.updates.has(updateFrame.updateID)).toBe(true)

    socket.receive({
      type: 'ack',
      updateID: updateFrame.updateID,
      bodyVersion: 2,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
    })
    await flushPromises()
    expect(store.updates.size).toBe(0)
    expect(store.snapshot?.bodyVersion).toBe(2)
    provider.stop()
  })

  it('applies remote updates and full-state resync without queuing local writes', async () => {
    const serverDoc = new Y.Doc()
    serverDoc.getText('body').insert(0, 'base')
    const initialState = Y.encodeStateAsUpdate(serverDoc)
    const document = new Y.Doc()
    Y.applyUpdate(document, initialState)
    const store = new MemoryStore()
    const socket = new FakeSocket()
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      baseURL: 'https://docs.example.test',
      store,
      socketFactory: () => socket,
    })

    await provider.start()
    socket.open()
    socket.receive({
      type: 'ready',
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      canEdit: true,
      state: base64(initialState),
    })
    await flushPromises()

    const remoteVector = Y.encodeStateVector(serverDoc)
    serverDoc.getText('body').insert(4, ' remote')
    socket.receive({
      type: 'update',
      updateID: 'remote-update',
      bodyVersion: 2,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      update: base64(Y.encodeStateAsUpdate(serverDoc, remoteVector)),
    })
    await flushPromises()
    expect(document.getText('body').toString()).toBe('base remote')
    expect(store.updates.size).toBe(0)
    expect(store.snapshot?.bodyVersion).toBe(2)

    serverDoc.getText('body').insert(11, '!')
    socket.receive({
      type: 'resync',
      bodyVersion: 3,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      canEdit: true,
      state: base64(Y.encodeStateAsUpdate(serverDoc)),
    })
    await flushPromises()
    expect(document.getText('body').toString()).toBe('base remote!')
    expect(store.snapshot?.bodyVersion).toBe(3)
    expect(store.updates.size).toBe(0)
    provider.stop()
  })

  it('holds pending updates from a different epoch for recovery', async () => {
    const document = new Y.Doc()
    const store = new MemoryStore()
    store.updates.set('old-update', {
      updateID: 'old-update',
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      update: new Uint8Array([1]),
    })
    const socket = new FakeSocket()
    const statuses: string[] = []
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 3,
      bodyEpoch: 2,
      bodySchemaVersion: 1,
      baseURL: 'https://docs.example.test',
      store,
      socketFactory: () => socket,
      onStatus: (status) => statuses.push(status),
    })

    await provider.start()
    expect(statuses.at(-1)).toBe('recovery-required')
    expect(socket.readyState).toBe(0)
    expect(store.updates.has('old-update')).toBe(true)
  })

  it('does not replay offline updates when the server grants read access only', async () => {
    const serverDoc = new Y.Doc()
    serverDoc.getText('body').insert(0, 'base')
    const initialState = Y.encodeStateAsUpdate(serverDoc)
    const offlineDoc = new Y.Doc()
    Y.applyUpdate(offlineDoc, initialState)
    const baseVector = Y.encodeStateVector(offlineDoc)
    offlineDoc.getText('body').insert(4, ' offline')
    const offlineUpdate = Y.encodeStateAsUpdate(offlineDoc, baseVector)
    const document = new Y.Doc()
    const store = new MemoryStore()
    store.updates.set('offline-update', {
      updateID: 'offline-update',
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      update: offlineUpdate,
    })
    const socket = new FakeSocket()
    const statuses: string[] = []
    const editCapabilities: boolean[] = []
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      store,
      socketFactory: () => socket,
      onStatus: (status) => statuses.push(status),
      onCanEdit: (canEdit) => editCapabilities.push(canEdit),
    })

    await provider.start()
    socket.open()
    socket.receive({
      type: 'ready',
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      canEdit: false,
      state: base64(initialState),
    })
    await flushPromises()

    expect(editCapabilities).toEqual([false])
    expect(statuses.at(-1)).toBe('recovery-required')
    expect(socket.sent.map((frame) => JSON.parse(frame).type)).toEqual(['auth'])
    expect(store.updates.has('offline-update')).toBe(true)
    expect(document.getText('body').toString()).toBe('base offline')
    provider.stop()
  })

  it('sends offline updates when the server grants suggest access without edit access', async () => {
    const serverDoc = new Y.Doc()
    serverDoc.getText('body').insert(0, 'base')
    const initialState = Y.encodeStateAsUpdate(serverDoc)
    const offlineDoc = new Y.Doc()
    Y.applyUpdate(offlineDoc, initialState)
    const baseVector = Y.encodeStateVector(offlineDoc)
    offlineDoc.getText('body').insert(4, ' suggested')
    const offlineUpdate = Y.encodeStateAsUpdate(offlineDoc, baseVector)
    const document = new Y.Doc()
    const store = new MemoryStore()
    store.updates.set('suggestion-update', {
      updateID: 'suggestion-update',
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      update: offlineUpdate,
    })
    const socket = new FakeSocket()
    const statuses: string[] = []
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      store,
      socketFactory: () => socket,
      onStatus: (status) => statuses.push(status),
    })

    await provider.start()
    socket.open()
    socket.receive({
      type: 'ready',
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      canEdit: false,
      canSuggest: true,
      state: base64(initialState),
    })
    await flushPromises()

    expect(statuses.at(-1)).not.toBe('recovery-required')
    expect(socket.sent.map((frame) => JSON.parse(frame).type)).toEqual([
      'auth',
      'update',
    ])
    provider.stop()
  })

  it('refreshes and caches a new canonical epoch when a clean client receives resync', async () => {
    const initialDocument = new Y.Doc()
    initialDocument.getText('body').insert(0, 'epoch one')
    const initialState = Y.encodeStateAsUpdate(initialDocument)
    const document = new Y.Doc()
    Y.applyUpdate(document, initialState)
    const store = new MemoryStore()
    const socket = new FakeSocket()
    const rootNodeID = crypto.randomUUID()
    const paragraphNodeID = crypto.randomUUID()
    let signalCanonical!: () => void
    const canonicalReceived = new Promise<void>((resolve) => {
      signalCanonical = resolve
    })
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      store,
      socketFactory: () => socket,
      refreshCanonicalBody: async () => ({
        bodyVersion: 2,
        bodyEpoch: 2,
        bodySchemaVersion: 1,
        canEdit: true,
        rootNodeID,
        nodes: [
          {
            nodeID: rootNodeID,
            parentID: null,
            siblingOrder: 0,
            type: 'document',
            content: '',
            attributes: {},
            version: 1,
          },
          {
            nodeID: paragraphNodeID,
            parentID: rootNodeID,
            siblingOrder: 0,
            type: 'paragraph',
            content: 'new epoch',
            attributes: {},
            version: 1,
          },
        ],
        encodedState: base64(initialState),
      }),
      onCanonicalBody: () => signalCanonical(),
    })

    try {
      await provider.start()
      socket.open()
      socket.receive({
        type: 'ready',
        bodyVersion: 1,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: true,
        state: base64(initialState),
      })
      await flushPromises()
      socket.receive({
        type: 'resync',
        bodyVersion: 2,
        bodyEpoch: 2,
        bodySchemaVersion: 1,
        canEdit: true,
        state: base64(initialState),
      })
      await canonicalReceived

      expect(store.snapshot?.bodyEpoch).toBe(2)
      expect(store.snapshot?.bodyVersion).toBe(2)
      expect(store.updates.size).toBe(0)
      expect(store.deleteCommands.size).toBe(0)
    } finally {
      provider.stop()
      initialDocument.destroy()
    }
  })

  it('restores the cached document and stores edits while offline', async () => {
    const cachedDocument = new Y.Doc()
    cachedDocument.getText('body').insert(0, 'cached')
    const store = new MemoryStore()
    store.snapshot = {
      bodyVersion: 4,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      encodedState: Y.encodeStateAsUpdate(cachedDocument),
    }
    const document = new Y.Doc()
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 3,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      baseURL: 'https://docs.example.test',
      store,
      socketFactory: () => new FakeSocket(),
    })

    await provider.start()
    expect(document.getText('body').toString()).toBe('cached')
    document.getText('body').insert(6, '!')
    await flushPromises()

    expect(document.getText('body').toString()).toBe('cached!')
    expect(store.updates.size).toBe(1)
    expect(store.snapshot?.bodyVersion).toBe(4)
    provider.stop()
  })

  it('does not persist an edit in a snapshot before its pending update', async () => {
    const document = new Y.Doc()
    document.getText('body').insert(0, 'base')
    const store = new MemoryStore()
    const snapshotGate = deferred()
    const updateGate = deferred()
    store.beforeSaveSnapshot = snapshotGate.promise
    store.beforeSaveUpdate = updateGate.promise
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      baseURL: 'https://docs.example.test',
      store,
      socketFactory: () => new FakeSocket(),
    })

    const started = provider.start()
    await flushPromises()
    document.getText('body').insert(4, '!')
    await flushPromises()
    snapshotGate.resolve()
    await flushPromises()

    const savedDocument = new Y.Doc()
    Y.applyUpdate(savedDocument, store.snapshot!.encodedState)
    expect(savedDocument.getText('body').toString()).toBe('base')
    expect(store.updates.size).toBe(0)

    updateGate.resolve()
    await Promise.all([started, flushPromises()])
    expect(store.updates.size).toBe(1)
    provider.stop()
  })

  it('replays the same durable update ID after reconnect', async () => {
    const serverDoc = new Y.Doc()
    serverDoc.getText('body').insert(0, 'base')
    const initialState = Y.encodeStateAsUpdate(serverDoc)
    const document = new Y.Doc()
    Y.applyUpdate(document, initialState)
    const store = new MemoryStore()
    const sockets: FakeSocket[] = []
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      baseURL: 'https://docs.example.test',
      store,
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })

    await provider.start()
    sockets[0]!.open()
    sockets[0]!.receive({
      type: 'ready',
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      canEdit: true,
      state: base64(initialState),
    })
    await flushPromises()

    document.getText('body').insert(4, '!')
    await flushPromises()
    const firstUpdate = JSON.parse(sockets[0]!.sent[1]!) as {
      updateID: string
    }
    expect(store.updates.has(firstUpdate.updateID)).toBe(true)

    sockets[0]!.close()
    await wait(300)
    expect(sockets).toHaveLength(2)
    sockets[1]!.open()
    sockets[1]!.receive({
      type: 'ready',
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      canEdit: true,
      state: base64(initialState),
    })
    await flushPromises()

    const retry = JSON.parse(sockets[1]!.sent[1]!) as {
      type: string
      updateID: string
    }
    expect(retry.type).toBe('update')
    expect(retry.updateID).toBe(firstUpdate.updateID)
    expect(store.updates.has(firstUpdate.updateID)).toBe(true)
    provider.stop()
  })

  it('queues DeleteNode offline and completes from the canonical body without a Yjs update', async () => {
    const serverDoc = new Y.Doc()
    serverDoc.getText('body').insert(0, 'base')
    const initialState = Y.encodeStateAsUpdate(serverDoc)
    const document = new Y.Doc()
    Y.applyUpdate(document, initialState)
    const store = new MemoryStore()
    const socket = new FakeSocket()
    const canonicalBodies: number[] = []
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      baseURL: 'https://docs.example.test',
      store,
      socketFactory: () => socket,
      executeDeleteNode: async () => ({
        bodyVersion: 2,
        bodyEpoch: 2,
        bodySchemaVersion: 1,
        canEdit: true,
        rootNodeID: crypto.randomUUID(),
        nodes: [],
        encodedState: base64(initialState),
      }),
      onCanonicalBody: (body) => canonicalBodies.push(body.bodyEpoch),
    })
    const originalOnline = navigator.onLine

    try {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value: false,
      })
      await provider.start()
      await provider.deleteNode('node-to-delete')
      const [pending] = store.deleteCommands.values()
      expect(pending).toMatchObject({
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        nodeID: 'node-to-delete',
      })
      expect(document.getText('body').toString()).toBe('base')

      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value: true,
      })
      await wait(300)
      socket.open()
      socket.receive({
        type: 'ready',
        bodyVersion: 1,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: true,
        state: base64(initialState),
      })
      await flushPromises()

      expect(store.deleteCommands.size).toBe(0)
      expect(store.snapshot?.bodyEpoch).toBe(2)
      expect(canonicalBodies).toEqual([2])
      expect(socket.sent.map((frame) => JSON.parse(frame).type)).toEqual([
        'auth',
      ])
    } finally {
      provider.stop()
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value: originalOnline,
      })
    }
  })

  it('queues one batch DeleteNode for several nodes and completes it from the canonical body', async () => {
    const serverDoc = new Y.Doc()
    serverDoc.getText('body').insert(0, 'base')
    const initialState = Y.encodeStateAsUpdate(serverDoc)
    const document = new Y.Doc()
    Y.applyUpdate(document, initialState)
    const store = new MemoryStore()
    const socket = new FakeSocket()
    const commands: PendingDeleteNodeCommand[] = []
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      baseURL: 'https://docs.example.test',
      store,
      socketFactory: () => socket,
      executeDeleteNode: async (command) => {
        commands.push(command)
        return {
          bodyVersion: 2,
          bodyEpoch: 2,
          bodySchemaVersion: 1,
          canEdit: true,
          rootNodeID: crypto.randomUUID(),
          nodes: [],
          encodedState: base64(initialState),
        }
      },
    })

    try {
      await provider.start()
      socket.open()
      socket.receive({
        type: 'ready',
        bodyVersion: 1,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: true,
        state: base64(initialState),
      })
      await flushPromises()
      await provider.deleteNode(['a', 'b', 'a', 'c'])
      await flushPromises()

      expect(commands).toHaveLength(1)
      expect(commands[0]).toMatchObject({
        bodyEpoch: 1,
        nodeID: 'a',
        nodeIDs: ['a', 'b', 'c'],
      })
      expect(store.deleteCommands.size).toBe(0)
      expect(store.snapshot?.bodyEpoch).toBe(2)
    } finally {
      provider.stop()
    }
  })

  it('queues MoveNode offline and completes from the canonical body without a Yjs update', async () => {
    const serverDoc = new Y.Doc()
    serverDoc.getText('body').insert(0, 'base')
    const initialState = Y.encodeStateAsUpdate(serverDoc)
    const document = new Y.Doc()
    Y.applyUpdate(document, initialState)
    const store = new MemoryStore()
    const socket = new FakeSocket()
    const commands: PendingMoveNodeCommand[] = []
    const canonicalBodies: number[] = []
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      baseURL: 'https://docs.example.test',
      store,
      socketFactory: () => socket,
      executeMoveNode: async (command) => {
        commands.push(command)
        return {
          bodyVersion: 2,
          bodyEpoch: 2,
          bodySchemaVersion: 1,
          canEdit: true,
          rootNodeID: crypto.randomUUID(),
          nodes: [],
          encodedState: base64(initialState),
        }
      },
      onCanonicalBody: (body) => canonicalBodies.push(body.bodyEpoch),
    })
    const originalOnline = navigator.onLine

    try {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value: false,
      })
      await provider.start()
      await provider.moveNode({
        nodeID: 'node-to-move',
        targetParentID: 'target-parent',
        beforeNodeID: 'next-sibling',
      })
      const [pending] = store.moveCommands.values()
      expect(pending).toMatchObject({
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        nodeID: 'node-to-move',
        targetParentID: 'target-parent',
        beforeNodeID: 'next-sibling',
      })
      expect(document.getText('body').toString()).toBe('base')

      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value: true,
      })
      await wait(300)
      socket.open()
      socket.receive({
        type: 'ready',
        bodyVersion: 1,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: true,
        state: base64(initialState),
      })
      await flushPromises()

      expect(commands).toEqual([pending])
      expect(store.moveCommands.size).toBe(0)
      expect(store.snapshot?.bodyEpoch).toBe(2)
      expect(canonicalBodies).toEqual([2])
      expect(socket.sent.map((frame) => JSON.parse(frame).type)).toEqual([
        'auth',
      ])
    } finally {
      provider.stop()
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value: originalOnline,
      })
    }
  })

  it('replays a MoveNode receipt after the response is lost and server epoch advances', async () => {
    const serverDoc = new Y.Doc()
    serverDoc.getText('body').insert(0, 'base')
    const initialState = Y.encodeStateAsUpdate(serverDoc)
    const document = new Y.Doc()
    Y.applyUpdate(document, initialState)
    const store = new MemoryStore()
    const sockets: FakeSocket[] = []
    const commandIDs: string[] = []
    const canonicalBodies: number[] = []
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      store,
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
      executeMoveNode: async (command) => {
        commandIDs.push(command.commandID)
        if (commandIDs.length === 1)
          throw new Error('response lost after commit')
        return {
          bodyVersion: 2,
          bodyEpoch: 2,
          bodySchemaVersion: 1,
          canEdit: true,
          rootNodeID: crypto.randomUUID(),
          nodes: [],
          encodedState: base64(initialState),
        }
      },
      onCanonicalBody: (body) => canonicalBodies.push(body.bodyEpoch),
    })

    await provider.start()
    sockets[0]!.open()
    sockets[0]!.receive({
      type: 'ready',
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      canEdit: true,
      state: base64(initialState),
    })
    await flushPromises()
    await provider.moveNode({
      nodeID: 'node-to-move',
      targetParentID: 'target-parent',
      beforeNodeID: null,
    })
    await flushPromises()
    await wait(300)

    expect(sockets).toHaveLength(2)
    sockets[1]!.open()
    sockets[1]!.receive({
      type: 'ready',
      bodyVersion: 2,
      bodyEpoch: 2,
      bodySchemaVersion: 1,
      canEdit: true,
      state: base64(initialState),
    })
    await flushPromises()

    expect(commandIDs).toHaveLength(2)
    expect(commandIDs[1]).toBe(commandIDs[0])
    expect(store.moveCommands.size).toBe(0)
    expect(store.snapshot?.bodyEpoch).toBe(2)
    expect(canonicalBodies).toEqual([2])
    provider.stop()
  })

  it('replays a pending MoveNode receipt on reload before showing epoch conflict', async () => {
    const serverDoc = new Y.Doc()
    serverDoc.getText('body').insert(0, 'canonical')
    const canonicalState = Y.encodeStateAsUpdate(serverDoc)
    const document = new Y.Doc()
    const store = new MemoryStore()
    store.snapshot = {
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      canEdit: true,
      encodedState: canonicalState,
    }
    const command: PendingMoveNodeCommand = {
      commandID: 'durable-command-id',
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      nodeID: 'node-to-move',
      targetParentID: 'target-parent',
      beforeNodeID: null,
    }
    store.moveCommands.set(command.commandID, command)
    const socketFactory = vi.fn(() => new FakeSocket())
    const canonicalBodies: number[] = []
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 2,
      bodyEpoch: 2,
      bodySchemaVersion: 1,
      store,
      socketFactory,
      executeMoveNode: async (received) => {
        expect(received).toEqual(command)
        return {
          bodyVersion: 2,
          bodyEpoch: 2,
          bodySchemaVersion: 1,
          canEdit: true,
          rootNodeID: crypto.randomUUID(),
          nodes: [],
          encodedState: base64(canonicalState),
        }
      },
      onCanonicalBody: (body) => canonicalBodies.push(body.bodyEpoch),
    })

    await provider.start()

    expect(socketFactory).not.toHaveBeenCalled()
    expect(store.moveCommands.size).toBe(0)
    expect(store.snapshot?.bodyEpoch).toBe(2)
    expect(canonicalBodies).toEqual([2])
    provider.stop()
  })

  it('retries a queued DeleteNode with the same durable command ID', async () => {
    const serverDoc = new Y.Doc()
    serverDoc.getText('body').insert(0, 'base')
    const initialState = Y.encodeStateAsUpdate(serverDoc)
    const document = new Y.Doc()
    Y.applyUpdate(document, initialState)
    const store = new MemoryStore()
    const sockets: FakeSocket[] = []
    const commandIDs: string[] = []
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      store,
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
      executeDeleteNode: async (command) => {
        commandIDs.push(command.commandID)
        if (commandIDs.length === 1) throw new Error('response lost')
        return {
          bodyVersion: 2,
          bodyEpoch: 2,
          bodySchemaVersion: 1,
          canEdit: true,
          rootNodeID: crypto.randomUUID(),
          nodes: [],
          encodedState: base64(initialState),
        }
      },
    })

    try {
      await provider.start()
      await provider.deleteNode('node-to-delete')
      sockets[0]!.open()
      sockets[0]!.receive({
        type: 'ready',
        bodyVersion: 1,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: true,
        state: base64(initialState),
      })
      await flushPromises()

      await wait(300)
      expect(sockets).toHaveLength(2)
      sockets[1]!.open()
      sockets[1]!.receive({
        type: 'ready',
        bodyVersion: 1,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: true,
        state: base64(initialState),
      })
      await flushPromises()

      expect(commandIDs).toHaveLength(2)
      expect(commandIDs[1]).toBe(commandIDs[0])
      expect(store.deleteCommands.size).toBe(0)
    } finally {
      provider.stop()
    }
  })

  it('waits for pending Yjs updates to be acknowledged before submitting DeleteNode', async () => {
    const serverDoc = new Y.Doc()
    serverDoc.getText('body').insert(0, 'base')
    const initialState = Y.encodeStateAsUpdate(serverDoc)
    const offlineDoc = new Y.Doc()
    Y.applyUpdate(offlineDoc, initialState)
    const vector = Y.encodeStateVector(offlineDoc)
    offlineDoc.getText('body').insert(4, '!')
    const update = Y.encodeStateAsUpdate(offlineDoc, vector)
    offlineDoc.destroy()

    const document = new Y.Doc()
    const store = new MemoryStore()
    store.snapshot = {
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      canEdit: true,
      encodedState: initialState,
    }
    store.updates.set('offline-update', {
      updateID: 'offline-update',
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      update,
    })
    store.deleteCommands.set('delete-command', {
      commandID: 'delete-command',
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      nodeID: 'node-to-delete',
    })
    const socket = new FakeSocket()
    let deleteAttempts = 0
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      store,
      socketFactory: () => socket,
      executeDeleteNode: async () => {
        deleteAttempts++
        return {
          bodyVersion: 3,
          bodyEpoch: 2,
          bodySchemaVersion: 1,
          canEdit: true,
          rootNodeID: crypto.randomUUID(),
          nodes: [],
          encodedState: base64(initialState),
        }
      },
    })

    await provider.start()
    socket.open()
    socket.receive({
      type: 'ready',
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      canEdit: true,
      state: base64(initialState),
    })
    await flushPromises()

    const updateFrame = socket.sent
      .map((frame) => JSON.parse(frame) as { type: string; updateID?: string })
      .find((frame) => frame.type === 'update')
    expect(updateFrame?.updateID).toBe('offline-update')
    expect(deleteAttempts).toBe(0)

    socket.receive({
      type: 'ack',
      updateID: 'offline-update',
      bodyVersion: 2,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
    })
    await flushPromises()

    expect(deleteAttempts).toBe(1)
    expect(store.deleteCommands.size).toBe(0)
    provider.stop()
  })
})

const ids = {
  root: '00000000-0000-4000-8000-000000000001',
  p1: '00000000-0000-4000-8000-000000000002',
  r1: '00000000-0000-4000-8000-000000000003',
  p2: '00000000-0000-4000-8000-000000000004',
  r2: '00000000-0000-4000-8000-000000000005',
}

function bodyNode(
  nodeID: string,
  parentID: string | null,
  siblingOrder: number,
  type: string,
  content = ''
): DocumentBodyNode {
  return { nodeID, parentID, siblingOrder, type, content, attributes: {} }
}

function twoParagraphs(): DocumentBodyNode[] {
  return [
    bodyNode(ids.root, null, 1, 'document'),
    bodyNode(ids.p1, ids.root, 1, 'paragraph'),
    bodyNode(ids.r1, ids.p1, 1, 'run', 'hello'),
    bodyNode(ids.p2, ids.root, 2, 'paragraph'),
    bodyNode(ids.r2, ids.p2, 1, 'run', 'second'),
  ]
}

function stateOf(nodes: DocumentBodyNode[]) {
  const doc = new Y.Doc()
  prosemirrorToYXmlFragment(
    documentBodyToProseMirror(nodes),
    doc.getXmlFragment('body')
  )
  return Y.encodeStateAsUpdate(doc)
}

function projectState(state: Uint8Array) {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, state)
  return prosemirrorToDocumentBody(
    yXmlFragmentToProseMirrorRootNode(
      doc.getXmlFragment('body'),
      documentBodySchema
    )
  )
}

function appendToFirstRun(doc: Y.Doc, text: string) {
  const root = doc.getXmlFragment('body').get(0) as Y.XmlElement
  const paragraph = root.get(0) as Y.XmlElement
  const run = paragraph.get(0) as Y.XmlElement
  const ytext = run.get(0) as Y.XmlText
  ytext.insert(ytext.length, text)
}

function canonicalBody(nodes: DocumentBodyNode[], epoch: number) {
  return {
    bodyVersion: epoch,
    bodyEpoch: epoch,
    bodySchemaVersion: 1,
    canEdit: true,
    rootNodeID: ids.root,
    nodes: nodes.map((node) => ({ ...node, version: 1 })),
    encodedState: base64(stateOf(nodes)),
  }
}

describe('CollaborativeDocumentProvider update batching', () => {
  async function readyProvider(
    sockets: FakeSocket[],
    store = new MemoryStore()
  ) {
    const serverDoc = new Y.Doc()
    serverDoc.getText('body').insert(0, 'base')
    const initialState = Y.encodeStateAsUpdate(serverDoc)
    const document = new Y.Doc()
    Y.applyUpdate(document, initialState)
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      store,
      batchIntervalMs: 80,
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    await provider.start()
    sockets[0]!.open()
    sockets[0]!.receive({
      type: 'ready',
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      canEdit: true,
      state: base64(initialState),
    })
    await flushPromises()
    return { provider, document, store, initialState }
  }

  function updateFrames(socket: FakeSocket) {
    return socket.sent
      .map((frame) => JSON.parse(frame))
      .filter((frame) => frame.type === 'update')
  }

  it('sends the first edit at once and merges the edits that follow into one update', async () => {
    const sockets: FakeSocket[] = []
    const { provider, document, store, initialState } =
      await readyProvider(sockets)
    const text = document.getText('body')

    try {
      text.insert(text.length, 'a')
      await flushPromises()
      text.insert(text.length, 'b')
      text.insert(text.length, 'c')
      await flushPromises()
      expect(updateFrames(sockets[0]!)).toHaveLength(1)

      await wait(160)
      const frames = updateFrames(sockets[0]!)
      expect(frames).toHaveLength(2)

      const server = new Y.Doc()
      Y.applyUpdate(server, initialState)
      for (const frame of frames)
        Y.applyUpdate(
          server,
          Uint8Array.from(atob(frame.update), (c) => c.charCodeAt(0))
        )
      expect(server.getText('body').toString()).toBe('baseabc')

      expect(store.updates.size).toBe(3)
      frames.forEach((frame, index) =>
        sockets[0]!.receive({
          type: 'ack',
          updateID: frame.updateID,
          bodyVersion: 2 + index,
          bodyEpoch: 1,
          bodySchemaVersion: 1,
        })
      )
      await wait(30)
      expect(store.updates.size).toBe(0)
    } finally {
      provider.stop()
    }
  })

  it('resends everything still pending as a single update after a reconnect', async () => {
    const sockets: FakeSocket[] = []
    const { provider, document, initialState } = await readyProvider(sockets)
    const text = document.getText('body')

    try {
      text.insert(text.length, 'a')
      await flushPromises()
      text.insert(text.length, 'b')
      text.insert(text.length, 'c')
      await wait(160)

      sockets[0]!.close()
      await wait(400)
      expect(sockets).toHaveLength(2)
      sockets[1]!.open()
      sockets[1]!.receive({
        type: 'ready',
        bodyVersion: 1,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: true,
        state: base64(initialState),
      })
      await wait(30)

      const frames = updateFrames(sockets[1]!)
      expect(frames).toHaveLength(1)
      const server = new Y.Doc()
      Y.applyUpdate(server, initialState)
      Y.applyUpdate(
        server,
        Uint8Array.from(atob(frames[0].update), (c) => c.charCodeAt(0))
      )
      expect(server.getText('body').toString()).toBe('baseabc')
    } finally {
      provider.stop()
    }
  })
})

describe('CollaborativeDocumentProvider structural command retarget', () => {
  const allNodes = () => twoParagraphs()
  const withoutP2 = () =>
    twoParagraphs().filter((n) => n.nodeID !== ids.p2 && n.nodeID !== ids.r2)

  function storedWithPending(command: {
    delete?: PendingDeleteNodeCommand
    move?: PendingMoveNodeCommand
  }) {
    const store = new MemoryStore()
    store.snapshot = {
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      canEdit: true,
      encodedState: stateOf(allNodes()),
    }
    if (command.delete)
      store.deleteCommands.set(command.delete.commandID, command.delete)
    if (command.move)
      store.moveCommands.set(command.move.commandID, command.move)
    return store
  }

  function providerAtEpoch2(
    store: MemoryStore,
    canonicalNodes: DocumentBodyNode[],
    overrides: Partial<
      ConstructorParameters<typeof CollaborativeDocumentProvider>[0]
    > = {}
  ) {
    const canonical = canonicalBody(canonicalNodes, 2)
    const document = new Y.Doc()
    Y.applyUpdate(document, decodeBase64ForTest(canonical.encodedState))
    const statuses: string[] = []
    const bodies: number[] = []
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 2,
      bodyEpoch: 2,
      bodySchemaVersion: 1,
      store,
      socketFactory: () => new FakeSocket(),
      refreshCanonicalBody: async () => canonical,
      onStatus: (status) => statuses.push(status),
      onCanonicalBody: (body) => bodies.push(body.bodyEpoch),
      ...overrides,
    })
    return { provider, statuses, bodies, canonical }
  }

  const staleEpoch = () => new ApiError(409, 'stale epoch')

  it('re-issues a DeleteNode with a new ID at the new epoch when its node still exists', async () => {
    const original: PendingDeleteNodeCommand = {
      commandID: 'old-command',
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      nodeID: ids.p2,
    }
    const store = storedWithPending({ delete: original })
    const sent: PendingDeleteNodeCommand[] = []
    const { provider, statuses, bodies } = providerAtEpoch2(store, allNodes(), {
      executeDeleteNode: async (command) => {
        sent.push(command)
        throw staleEpoch()
      },
    })

    await provider.start()
    await wait(50)

    expect(sent).toEqual([original])
    expect(statuses).not.toContain('recovery-required')
    expect([...store.deleteCommands.values()]).toEqual([
      {
        commandID: expect.not.stringMatching(/^old-command$/),
        bodyEpoch: 2,
        bodySchemaVersion: 1,
        nodeID: ids.p2,
      },
    ])
    expect(store.snapshot?.bodyEpoch).toBe(2)
    expect(bodies).toEqual([2])
    provider.stop()
  })

  it('treats a DeleteNode as done when its node is already gone', async () => {
    const original: PendingDeleteNodeCommand = {
      commandID: 'old-command',
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      nodeID: ids.p2,
    }
    const store = storedWithPending({ delete: original })
    const { provider, statuses, bodies } = providerAtEpoch2(
      store,
      withoutP2(),
      {
        executeDeleteNode: async () => {
          throw staleEpoch()
        },
      }
    )

    await provider.start()
    await wait(50)

    expect(statuses).not.toContain('recovery-required')
    expect(store.deleteCommands.size).toBe(0)
    expect(store.snapshot?.bodyEpoch).toBe(2)
    expect(bodies).toEqual([2])
    provider.stop()
  })

  it('keeps a DeleteNode for review when the block gained content the user never saw', async () => {
    const original: PendingDeleteNodeCommand = {
      commandID: 'old-command',
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      nodeID: ids.p2,
    }
    const store = storedWithPending({ delete: original })
    const grown = [
      ...allNodes(),
      bodyNode(
        '00000000-0000-4000-8000-000000000006',
        ids.p2,
        2,
        'run',
        ' new'
      ),
    ]
    const { provider, statuses } = providerAtEpoch2(store, grown, {
      executeDeleteNode: async () => {
        throw staleEpoch()
      },
    })

    await provider.start()
    await wait(50)

    expect(statuses.at(-1)).toBe('recovery-required')
    expect([...store.deleteCommands.values()]).toEqual([original])
    provider.stop()
  })

  it('re-issues a MoveNode when its node and target still exist', async () => {
    const original: PendingMoveNodeCommand = {
      commandID: 'old-move',
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      nodeID: ids.p2,
      targetParentID: ids.root,
      beforeNodeID: ids.p1,
    }
    const store = storedWithPending({ move: original })
    const { provider, statuses } = providerAtEpoch2(store, allNodes(), {
      executeMoveNode: async () => {
        throw staleEpoch()
      },
    })

    await provider.start()
    await wait(50)

    expect(statuses).not.toContain('recovery-required')
    expect([...store.moveCommands.values()]).toEqual([
      {
        commandID: expect.not.stringMatching(/^old-move$/),
        bodyEpoch: 2,
        bodySchemaVersion: 1,
        nodeID: ids.p2,
        targetParentID: ids.root,
        beforeNodeID: ids.p1,
      },
    ])
    provider.stop()
  })

  it('re-issues a MoveNode to the end of its parent when no beforeNodeID was stored', async () => {
    const original = {
      commandID: 'old-move',
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      nodeID: ids.p1,
      targetParentID: ids.root,
    } as PendingMoveNodeCommand
    const store = storedWithPending({ move: original })
    const { provider, statuses } = providerAtEpoch2(store, allNodes(), {
      executeMoveNode: async () => {
        throw staleEpoch()
      },
    })

    await provider.start()
    await wait(50)

    expect(statuses).not.toContain('recovery-required')
    expect([...store.moveCommands.values()]).toEqual([
      expect.objectContaining({
        commandID: expect.not.stringMatching(/^old-move$/),
        bodyEpoch: 2,
        nodeID: ids.p1,
      }),
    ])
    provider.stop()
  })

  it('keeps a MoveNode for review when its target no longer exists', async () => {
    const original: PendingMoveNodeCommand = {
      commandID: 'old-move',
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      nodeID: ids.r2,
      targetParentID: ids.p2,
      beforeNodeID: null,
    }
    const store = storedWithPending({ move: original })
    const { provider, statuses } = providerAtEpoch2(store, withoutP2(), {
      executeMoveNode: async () => {
        throw staleEpoch()
      },
    })

    await provider.start()
    await wait(50)

    expect(statuses.at(-1)).toBe('recovery-required')
    expect([...store.moveCommands.values()]).toEqual([original])
    provider.stop()
  })

  it('keeps a MoveNode for review when its beforeNodeID was deleted', async () => {
    const original: PendingMoveNodeCommand = {
      commandID: 'old-move',
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      nodeID: ids.p2,
      targetParentID: ids.root,
      beforeNodeID: 'deleted-sibling',
    }
    const store = storedWithPending({ move: original })
    const { provider, statuses } = providerAtEpoch2(store, allNodes(), {
      executeMoveNode: async () => {
        throw staleEpoch()
      },
    })

    await provider.start()
    await wait(50)

    expect(statuses.at(-1)).toBe('recovery-required')
    expect([...store.moveCommands.values()]).toEqual([original])
    provider.stop()
  })

  it('sends the re-issued DeleteNode once the session restarts at the new epoch', async () => {
    const store = storedWithPending({
      delete: {
        commandID: 'old-command',
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        nodeID: ids.p2,
      },
    })
    const first = providerAtEpoch2(store, allNodes(), {
      executeDeleteNode: async () => {
        throw staleEpoch()
      },
    })
    await first.provider.start()
    await wait(50)
    first.provider.stop()
    const [reissued] = [...store.deleteCommands.values()]
    expect(reissued!.commandID).not.toBe('old-command')

    const socket = new FakeSocket()
    const received: PendingDeleteNodeCommand[] = []
    const second = providerAtEpoch2(store, allNodes(), {
      socketFactory: () => socket,
      executeDeleteNode: async (command) => {
        received.push(command)
        return canonicalBody(withoutP2(), 3)
      },
    })
    await second.provider.start()
    socket.open()
    socket.receive({
      type: 'ready',
      bodyVersion: 2,
      bodyEpoch: 2,
      bodySchemaVersion: 1,
      canEdit: true,
      state: second.canonical.encodedState,
    })
    await wait(50)

    expect(received).toEqual([reissued])
    expect(store.deleteCommands.size).toBe(0)
    expect(store.snapshot?.bodyEpoch).toBe(3)
    second.provider.stop()
  })
})

describe('CollaborativeDocumentProvider presence', () => {
  it('reports connected users and clears them when the connection drops', async () => {
    const document = new Y.Doc()
    const socket = new FakeSocket()
    const seen: Array<Array<{ userID: string; name?: string }>> = []
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      store: new MemoryStore(),
      socketFactory: () => socket,
      onPresence: (users) => seen.push(users),
    })

    try {
      await provider.start()
      socket.open()
      socket.receive({
        type: 'ready',
        bodyVersion: 1,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: true,
        state: base64(Y.encodeStateAsUpdate(document)),
      })
      await flushPromises()
      socket.receive({
        type: 'presence',
        users: [
          { userID: 'user-1', name: 'Ada' },
          { userID: 'user-2', name: 'Bo' },
        ],
      })
      expect(seen.at(-1)).toEqual([
        { userID: 'user-1', name: 'Ada' },
        { userID: 'user-2', name: 'Bo' },
      ])

      socket.close()
      expect(seen.at(-1)).toEqual([])
    } finally {
      provider.stop()
    }
  })
})

describe('CollaborativeDocumentProvider remote cursors', () => {
  it('tracks cursors per connection, removes them on leave, and clears them on disconnect', async () => {
    const document = new Y.Doc()
    const socket = new FakeSocket()
    const seen: Array<Array<{ connectionID: string; name?: string }>> = []
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      store: new MemoryStore(),
      socketFactory: () => socket,
      onRemoteCursors: (cursors) => seen.push(cursors),
    })

    try {
      await provider.start()
      socket.open()
      socket.receive({
        type: 'ready',
        bodyVersion: 1,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: true,
        state: base64(Y.encodeStateAsUpdate(document)),
      })
      await flushPromises()

      socket.receive({
        type: 'cursor',
        cursor: {
          connectionID: 'c1',
          userID: 'u2',
          name: 'Bo',
          color: '#0369A1',
          anchor: 'AQ==',
          head: 'Ag==',
        },
      })
      socket.receive({
        type: 'cursor',
        cursor: {
          connectionID: 'c2',
          userID: 'u3',
          name: 'Cy',
          color: '#B45309',
          anchor: 'AQ==',
          head: 'Ag==',
        },
      })
      expect(seen.at(-1)?.map((cursor) => cursor.connectionID)).toEqual([
        'c1',
        'c2',
      ])

      socket.receive({
        type: 'cursor_leave',
        cursor: { connectionID: 'c1', userID: 'u2' },
      })
      expect(seen.at(-1)?.map((cursor) => cursor.connectionID)).toEqual(['c2'])

      expect(
        provider.sendCursor({
          anchor: new Uint8Array([1]),
          head: new Uint8Array([2]),
        })
      ).toBe(true)

      socket.close()
      expect(seen.at(-1)).toEqual([])
    } finally {
      provider.stop()
    }
  })
})

describe('CollaborativeDocumentProvider epoch rebase', () => {
  it('rebases pending text edits onto a new epoch instead of requiring recovery', async () => {
    const baseState = stateOf(twoParagraphs())
    const document = new Y.Doc()
    Y.applyUpdate(document, baseState)
    const store = new MemoryStore()
    const socket = new FakeSocket()
    const statuses: string[] = []
    const canonical = canonicalBody(
      twoParagraphs().filter((n) => n.nodeID !== ids.p2 && n.nodeID !== ids.r2),
      2
    )
    let rebased: typeof canonical | undefined
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      store,
      socketFactory: () => socket,
      refreshCanonicalBody: async () => canonical,
      onStatus: (status) => statuses.push(status),
      onCanonicalBody: (body) => {
        rebased = body as typeof canonical
      },
    })

    try {
      await provider.start()
      socket.open()
      socket.receive({
        type: 'ready',
        bodyVersion: 1,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: true,
        state: base64(baseState),
      })
      await flushPromises()
      document.transact(() => appendToFirstRun(document, ' world'))
      await flushPromises()
      const originalUpdateID = [...store.updates.keys()][0]
      expect(originalUpdateID).toBeDefined()

      socket.receive({
        type: 'resync',
        bodyVersion: 2,
        bodyEpoch: 2,
        bodySchemaVersion: 1,
        canEdit: true,
        state: canonical.encodedState,
      })
      await wait(50)

      expect(statuses).not.toContain('recovery-required')
      expect(rebased).toBeDefined()
      expect(
        projectState(decodeBase64ForTest(rebased!.encodedState)).map((n) => [
          n.nodeID,
          n.content,
        ])
      ).toEqual([
        [ids.root, ''],
        [ids.p1, ''],
        [ids.r1, 'hello world'],
      ])
      expect(store.snapshot?.bodyEpoch).toBe(2)
      expect(store.updates.size).toBe(1)
      const [pending] = [...store.updates.values()]
      expect(pending!.bodyEpoch).toBe(2)
      expect(pending!.updateID).not.toBe(originalUpdateID)
    } finally {
      provider.stop()
    }
  })

  it('applies the clean edit and holds only the conflicting block for review', async () => {
    const baseState = stateOf(twoParagraphs())
    const document = new Y.Doc()
    Y.applyUpdate(document, baseState)
    const store = new MemoryStore()
    const socket = new FakeSocket()
    const statuses: string[] = []
    const canonicalNodes = twoParagraphs().map((n) =>
      n.nodeID === ids.r2 ? { ...n, content: 'second?' } : n
    )
    const canonical = canonicalBody(canonicalNodes, 2)
    let rebased: typeof canonical | undefined
    let held: HeldEdit[] = []
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      store,
      socketFactory: () => socket,
      refreshCanonicalBody: async () => canonical,
      onStatus: (status) => statuses.push(status),
      onCanonicalBody: (body) => {
        rebased = body as typeof canonical
      },
      onHeldEdits: (edits) => {
        held = edits
      },
    })

    try {
      await provider.start()
      socket.open()
      socket.receive({
        type: 'ready',
        bodyVersion: 1,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: true,
        state: base64(baseState),
      })
      await flushPromises()
      document.transact(() => {
        appendToFirstRun(document, ' world')
        const root = document.getXmlFragment('body').get(0) as Y.XmlElement
        const run = (root.get(1) as Y.XmlElement).get(0) as Y.XmlElement
        const text = run.get(0) as Y.XmlText
        text.insert(text.length, '!')
      })
      await flushPromises()

      socket.receive({
        type: 'resync',
        bodyVersion: 2,
        bodyEpoch: 2,
        bodySchemaVersion: 1,
        canEdit: true,
        state: canonical.encodedState,
      })
      await wait(50)

      expect(statuses).not.toContain('recovery-required')
      const content = (id: string) =>
        projectState(decodeBase64ForTest(rebased!.encodedState)).find(
          (n) => n.nodeID === id
        )?.content
      expect(content(ids.r1)).toBe('hello world')
      expect(content(ids.r2)).toBe('second?')
      expect(held.map((h) => [h.nodeID, h.local.content])).toEqual([
        [ids.r2, 'second!'],
      ])
      expect(store.heldEdits.map((h) => h.nodeID)).toEqual([ids.r2])
      expect(store.snapshot?.bodyEpoch).toBe(2)
    } finally {
      provider.stop()
    }
  })

  it('keeps pending edits for review when the edited block was deleted remotely', async () => {
    const baseState = stateOf(twoParagraphs())
    const document = new Y.Doc()
    Y.applyUpdate(document, baseState)
    const store = new MemoryStore()
    const socket = new FakeSocket()
    const statuses: string[] = []
    const canonical = canonicalBody(
      twoParagraphs().filter((n) => n.nodeID !== ids.p1 && n.nodeID !== ids.r1),
      2
    )
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      store,
      socketFactory: () => socket,
      refreshCanonicalBody: async () => canonical,
      onStatus: (status) => statuses.push(status),
    })

    try {
      await provider.start()
      socket.open()
      socket.receive({
        type: 'ready',
        bodyVersion: 1,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: true,
        state: base64(baseState),
      })
      await flushPromises()
      document.transact(() => appendToFirstRun(document, ' world'))
      await flushPromises()
      const [original] = [...store.updates.values()]

      socket.receive({
        type: 'resync',
        bodyVersion: 2,
        bodyEpoch: 2,
        bodySchemaVersion: 1,
        canEdit: true,
        state: canonical.encodedState,
      })
      await wait(50)

      expect(statuses.at(-1)).toBe('recovery-required')
      expect(store.updates.get(original!.updateID)).toEqual(original)
    } finally {
      provider.stop()
    }
  })

  it('rebases pending edits found on reload when the server epoch moved on', async () => {
    const baseState = stateOf(twoParagraphs())
    const localDocument = new Y.Doc()
    Y.applyUpdate(localDocument, baseState)
    const updates: Uint8Array[] = []
    localDocument.on('update', (update: Uint8Array) => updates.push(update))
    localDocument.transact(() => appendToFirstRun(localDocument, ' world'))
    const store = new MemoryStore()
    store.snapshot = {
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      canEdit: true,
      encodedState: Y.encodeStateAsUpdate(localDocument),
      baseEncodedState: baseState,
    }
    store.updates.set('offline-edit', {
      updateID: 'offline-edit',
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      update: updates[0]!,
    })
    const canonical = canonicalBody(
      twoParagraphs().filter((n) => n.nodeID !== ids.p2 && n.nodeID !== ids.r2),
      2
    )
    const document = new Y.Doc()
    Y.applyUpdate(document, decodeBase64ForTest(canonical.encodedState))
    const statuses: string[] = []
    let rebased: typeof canonical | undefined
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 2,
      bodyEpoch: 2,
      bodySchemaVersion: 1,
      store,
      socketFactory: () => new FakeSocket(),
      onStatus: (status) => statuses.push(status),
      onCanonicalBody: (body) => {
        rebased = body as typeof canonical
      },
    })

    try {
      await provider.start()
      await wait(50)
      expect(statuses).not.toContain('recovery-required')
      expect(
        projectState(decodeBase64ForTest(rebased!.encodedState)).find(
          (n) => n.nodeID === ids.r1
        )?.content
      ).toBe('hello world')
      expect(store.snapshot?.bodyEpoch).toBe(2)
      expect([...store.updates.values()].map((u) => u.bodyEpoch)).toEqual([2])
    } finally {
      provider.stop()
    }
  })
})

function decodeBase64ForTest(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
}

describe('CollaborativeDocumentProvider access loss and session expiry', () => {
  async function connectedProvider(
    overrides: Partial<
      ConstructorParameters<typeof CollaborativeDocumentProvider>[0]
    > = {}
  ) {
    const serverDoc = new Y.Doc()
    serverDoc.getText('body').insert(0, 'base')
    const initialState = Y.encodeStateAsUpdate(serverDoc)
    const document = new Y.Doc()
    Y.applyUpdate(document, initialState)
    const store = new MemoryStore()
    const sockets: FakeSocket[] = []
    const statuses: string[] = []
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      store,
      batchIntervalMs: 20,
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
      onStatus: (status) => statuses.push(status),
      ...overrides,
    })
    await provider.start()
    sockets[0]?.open()
    sockets[0]?.receive({
      type: 'ready',
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      canEdit: true,
      state: base64(initialState),
    })
    await flushPromises()
    return { provider, document, store, sockets, statuses }
  }

  const sentUpdates = (socket: FakeSocket) =>
    socket.sent.map((f) => JSON.parse(f)).filter((f) => f.type === 'update')

  const reloadedBody = {
    bodyVersion: 2,
    bodyEpoch: 1,
    bodySchemaVersion: 1,
    canEdit: true,
    rootNodeID: 'root',
    nodes: [],
    encodedState: base64(new Uint8Array()),
  } as unknown as Awaited<
    ReturnType<typeof import('@/lib/domain-api').getMarkdownBody>
  >

  it.each(['needs_command', 'invalid_body', 'not_permitted'])(
    'drops an edit the server refuses as %s and reloads the body without asking for review',
    async (code) => {
      const reloaded: unknown[] = []
      const dropped: string[] = []
      const { provider, document, store, sockets, statuses } =
        await connectedProvider({
          documentID: `document-${code}`,
          refreshCanonicalBody: async () => reloadedBody,
          onCanonicalBody: (body) => reloaded.push(body),
          onEditDropped: (reason) => dropped.push(reason),
        })
      document.getText('body').insert(4, ' typed')
      await wait(60)
      const [first] = sentUpdates(sockets[0]!)
      expect(first).toBeDefined()

      sockets[0]!.receive({ type: 'error', updateID: first.updateID, code })
      await wait(40)

      expect(statuses).not.toContain('recovery-required')
      expect(dropped).toEqual([code])
      expect(store.updates.size).toBe(0)
      expect(reloaded).toHaveLength(1)
      provider.stop()
    }
  )

  it('asks for review when the same refusal keeps coming back on every load', async () => {
    const outcomes: string[][] = []
    for (let attempt = 0; attempt < 3; attempt++) {
      const statuses: string[] = []
      const { provider, document, sockets } = await connectedProvider({
        documentID: 'document-repeating',
        refreshCanonicalBody: async () => reloadedBody,
        onStatus: (status) => statuses.push(status),
      })
      document.getText('body').insert(4, ' typed')
      await wait(60)
      const [first] = sentUpdates(sockets[0]!)
      sockets[0]!.receive({
        type: 'error',
        updateID: first.updateID,
        code: 'invalid_body',
      })
      await wait(40)
      outcomes.push(statuses)
      provider.stop()
    }
    expect(outcomes[0]).not.toContain('recovery-required')
    expect(outcomes[1]).not.toContain('recovery-required')
    expect(outcomes[2]).toContain('recovery-required')
  })

  it('drops the cached body and pending edits when access is revoked mid-edit', async () => {
    const { provider, document, store, sockets, statuses } =
      await connectedProvider()
    const text = document.getText('body')
    text.insert(text.length, ' first')
    await wait(60)
    expect(sentUpdates(sockets[0]!)).toHaveLength(1)
    expect(store.updates.size).toBe(1)

    sockets[0]!.receive({ type: 'error', code: 'forbidden' })
    await flushPromises()

    expect(statuses.at(-1)).toBe('forbidden')
    expect(store.snapshot).toBeNull()
    expect(store.updates.size).toBe(0)

    text.insert(text.length, ' after revoke')
    await wait(80)
    expect(sentUpdates(sockets[0]!)).toHaveLength(1)
    expect(store.updates.size).toBe(0)
    expect(sockets).toHaveLength(1)
    provider.stop()
  })

  it('keeps pending edits for the same user when the token is rejected after being offline', async () => {
    const { provider, document, store, sockets, statuses } =
      await connectedProvider()
    sockets[0]!.close()
    const text = document.getText('body')
    text.insert(text.length, ' offline')
    await wait(60)
    expect(store.updates.size).toBe(1)

    await wait(400)
    expect(sockets).toHaveLength(2)
    sockets[1]!.open()
    sockets[1]!.receive({ type: 'error', code: 'unauthorized' })
    await flushPromises()

    expect(statuses.at(-1)).toBe('unauthorized')
    expect(store.updates.size).toBe(1)
    expect(store.snapshot).not.toBeNull()
    expect(sentUpdates(sockets[1]!)).toHaveLength(0)
    await wait(400)
    expect(sockets).toHaveLength(2)
    provider.stop()
  })

  it('does not open a socket or lose pending edits when the stored token has expired', async () => {
    const store = new MemoryStore()
    const serverDoc = new Y.Doc()
    serverDoc.getText('body').insert(0, 'base')
    const initialState = Y.encodeStateAsUpdate(serverDoc)
    const offlineDoc = new Y.Doc()
    Y.applyUpdate(offlineDoc, initialState)
    const baseVector = Y.encodeStateVector(offlineDoc)
    offlineDoc.getText('body').insert(4, ' offline')
    store.snapshot = {
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      canEdit: true,
      encodedState: initialState,
    }
    store.updates.set('offline-update', {
      updateID: 'offline-update',
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      update: Y.encodeStateAsUpdate(offlineDoc, baseVector),
    })
    const statuses: string[] = []
    const sockets: FakeSocket[] = []
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: () => '',
      document: new Y.Doc(),
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      store,
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
      onStatus: (status) => statuses.push(status),
    })

    await provider.start()
    await flushPromises()

    expect(sockets).toHaveLength(0)
    expect(statuses.at(-1)).toBe('unauthorized')
    expect(store.updates.has('offline-update')).toBe(true)
    provider.stop()
  })

  it('keeps the update pending and reconnects when the server reports a store outage', async () => {
    const { provider, document, store, sockets, statuses } =
      await connectedProvider()
    document.getText('body').insert(4, ' during outage')
    await wait(60)
    const [first] = sentUpdates(sockets[0]!)
    expect(first).toBeDefined()

    sockets[0]!.receive({
      type: 'error',
      updateID: first.updateID,
      code: 'unavailable',
    })
    await flushPromises()

    expect(statuses).not.toContain('recovery-required')
    expect(store.updates.size).toBe(1)
    await wait(400)
    expect(sockets).toHaveLength(2)
    sockets[1]!.open()
    sockets[1]!.receive({
      type: 'ready',
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      canEdit: true,
      state: base64(Y.encodeStateAsUpdate(new Y.Doc())),
    })
    await wait(60)
    expect(sentUpdates(sockets[1]!).length).toBeGreaterThan(0)
    provider.stop()
  })

  it('reports drained once every pending update is acknowledged, and not before', async () => {
    const { provider, document, sockets } = await connectedProvider()
    document.getText('body').insert(4, ' edit')
    await wait(60)
    const [sent] = sentUpdates(sockets[0]!)

    expect(await provider.whenDrained(50)).toBe(false)

    sockets[0]!.receive({
      type: 'ack',
      updateID: sent.updateID,
      bodyVersion: 2,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
    })
    expect(await provider.whenDrained(1000)).toBe(true)
    provider.stop()
  })

  it('gives up draining while offline instead of waiting forever', async () => {
    const { provider, document, store, sockets } = await connectedProvider()
    sockets[0]!.close()
    document.getText('body').insert(4, ' offline')
    await wait(60)
    expect(await provider.whenDrained(100)).toBe(false)
    expect(store.updates.size).toBe(1)
    provider.stop()
  })

  it('sends the token the app holds at reconnect time, so a refreshed session resumes sync', async () => {
    let token = 'old-jwt'
    const { provider, document, store, sockets } = await connectedProvider({
      token: () => token,
    })
    sockets[0]!.close()
    document.getText('body').insert(4, ' offline')
    await wait(60)
    token = 'fresh-jwt'

    await wait(400)
    sockets[1]!.open()
    const auth = JSON.parse(sockets[1]!.sent[0]!)
    expect(JSON.stringify(auth)).toContain('fresh-jwt')
    expect(store.updates.size).toBe(1)
    provider.stop()
  })
})

describe('CollaborativeDocumentProvider comments hint', () => {
  it('tells the caller when the server says comments changed', async () => {
    const document = new Y.Doc()
    const socket = new FakeSocket()
    let hints = 0
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      store: new MemoryStore(),
      socketFactory: () => socket,
      onCommentsChanged: () => {
        hints++
      },
    })

    try {
      await provider.start()
      socket.open()
      socket.receive({
        type: 'ready',
        bodyVersion: 1,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: true,
        state: base64(Y.encodeStateAsUpdate(document)),
      })
      await flushPromises()

      socket.receive({ type: 'comments_changed' })
      socket.receive({ type: 'comments_changed' })

      expect(hints).toBe(2)
    } finally {
      provider.stop()
    }
  })
})

describe('CollaborativeDocumentProvider compatible epochs', () => {
  const sentUpdates = (socket: FakeSocket) =>
    socket.sent
      .map(
        (message) =>
          JSON.parse(message) as {
            type: string
            bodyEpoch: number
            updateID: string
          }
      )
      .filter((message) => message.type === 'update')

  async function readyProvider() {
    const document = new Y.Doc()
    const socket = new FakeSocket()
    const statuses: string[] = []
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document,
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      store: new MemoryStore(),
      socketFactory: () => socket,
      batchIntervalMs: 0,
      onStatus: (status) => statuses.push(status),
    })
    await provider.start()
    socket.open()
    socket.receive({
      type: 'ready',
      bodyVersion: 1,
      bodyEpoch: 1,
      compatEpoch: 1,
      bodySchemaVersion: 1,
      canEdit: false,
      canSuggest: true,
      state: base64(Y.encodeStateAsUpdate(document)),
    })
    await flushPromises()
    return { document, socket, statuses, provider }
  }

  it('takes the new epoch from the ack of an update the server accepted from the old one', async () => {
    const { document, socket, statuses, provider } = await readyProvider()
    try {
      document.getText('body').insert(0, 'typed before the delete')
      await flushPromises()
      const [first] = sentUpdates(socket)
      expect(first?.bodyEpoch).toBe(1)

      socket.receive({
        type: 'ack',
        updateID: first!.updateID,
        bodyVersion: 2,
        bodyEpoch: 2,
        bodySchemaVersion: 1,
      })
      await flushPromises()
      expect(statuses).not.toContain('recovery-required')

      document.getText('body').insert(0, 'and after ')
      await flushPromises()
      expect(sentUpdates(socket).at(-1)?.bodyEpoch).toBe(2)
    } finally {
      provider.stop()
    }
  })

  it('adopts a resync whose history is compatible, and sends later edits on the new epoch', async () => {
    const { document, socket, statuses, provider } = await readyProvider()
    try {
      socket.receive({
        type: 'resync',
        bodyVersion: 2,
        bodyEpoch: 2,
        compatEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: false,
        canSuggest: true,
        state: base64(Y.encodeStateAsUpdate(document)),
      })
      await flushPromises()
      expect(statuses).not.toContain('recovery-required')

      document.getText('body').insert(0, 'after the resync')
      await flushPromises()
      expect(sentUpdates(socket).at(-1)?.bodyEpoch).toBe(2)
    } finally {
      provider.stop()
    }
  })

  it('keeps the review path for an editor, whose edit could aim at a deleted block', async () => {
    const { document, socket, provider } = await readyProvider()
    try {
      socket.receive({
        type: 'resync',
        bodyVersion: 2,
        bodyEpoch: 2,
        compatEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: true,
        state: base64(Y.encodeStateAsUpdate(document)),
      })
      await flushPromises()

      document.getText('body').insert(0, 'an editor typing')
      await flushPromises()
      expect(
        sentUpdates(socket).filter((message) => message.bodyEpoch === 2)
      ).toEqual([])
    } finally {
      provider.stop()
    }
  })

  it('does not take a newer epoch on trust for an edit made offline', async () => {
    const document = new Y.Doc()
    document.getText('body').insert(0, 'typed offline')
    const store = new MemoryStore()
    store.updates.set('offline', {
      updateID: 'offline',
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      update: Y.encodeStateAsUpdate(document),
    })
    const socket = new FakeSocket()
    const provider = new CollaborativeDocumentProvider({
      documentID: 'document-1',
      workspaceID: 'workspace-1',
      userID: 'user-1',
      token: 'jwt-token',
      document: new Y.Doc(),
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      store,
      socketFactory: () => socket,
      batchIntervalMs: 0,
    })
    try {
      await provider.start()
      socket.open()
      socket.receive({
        type: 'ready',
        bodyVersion: 2,
        bodyEpoch: 2,
        compatEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: false,
        canSuggest: true,
        state: base64(Y.encodeStateAsUpdate(new Y.Doc())),
      })
      await flushPromises()

      // The edit may be aimed at a block deleted meanwhile, so it is not sent
      // as if nothing had changed; it keeps the review path.
      expect(
        sentUpdates(socket).filter((message) => message.bodyEpoch === 2)
      ).toEqual([])
      expect(store.updates.has('offline')).toBe(true)
    } finally {
      provider.stop()
    }
  })

  it('does not adopt a resync whose history starts over', async () => {
    const { document, socket, provider } = await readyProvider()
    try {
      document.getText('body').insert(0, 'unsent edit')
      socket.receive({
        type: 'resync',
        bodyVersion: 2,
        bodyEpoch: 2,
        compatEpoch: 2,
        bodySchemaVersion: 1,
        canEdit: false,
        canSuggest: true,
        state: base64(Y.encodeStateAsUpdate(new Y.Doc())),
      })
      await flushPromises()

      // The old path: the edit is not sent as if the history continued.
      expect(
        sentUpdates(socket).filter((message) => message.bodyEpoch === 2)
      ).toEqual([])
    } finally {
      provider.stop()
    }
  })

  describe('edits saved under an older epoch before a reload', () => {
    async function reloadedProvider(access: {
      canEdit: boolean
      canSuggest: boolean
    }) {
      const typed = new Y.Doc()
      typed.getText('body').insert(0, 'typed offline')
      const store = new MemoryStore()
      store.snapshot = {
        bodyVersion: 1,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        encodedState: Y.encodeStateAsUpdate(new Y.Doc()),
      }
      store.updates.set('offline', {
        updateID: 'offline',
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        update: Y.encodeStateAsUpdate(typed),
      })
      const socket = new FakeSocket()
      const statuses: string[] = []
      const provider = new CollaborativeDocumentProvider({
        documentID: 'document-1',
        workspaceID: 'workspace-1',
        userID: 'user-1',
        token: 'jwt-token',
        document: new Y.Doc(),
        bodyVersion: 2,
        bodyEpoch: 2,
        compatEpoch: 1,
        bodySchemaVersion: 1,
        ...access,
        store,
        socketFactory: () => socket,
        batchIntervalMs: 0,
        onStatus: (status) => statuses.push(status),
      })
      await provider.start()
      return { store, socket, statuses, provider }
    }

    it('takes the current epoch for someone who can only suggest', async () => {
      const { store, statuses, provider } = await reloadedProvider({
        canEdit: false,
        canSuggest: true,
      })
      try {
        expect(statuses).not.toContain('recovery-required')
        expect(store.updates.get('offline')?.bodyEpoch).toBe(2)
      } finally {
        provider.stop()
      }
    })

    it('keeps the review path for an editor', async () => {
      const { statuses, provider } = await reloadedProvider({
        canEdit: true,
        canSuggest: false,
      })
      try {
        expect(statuses).toContain('recovery-required')
      } finally {
        provider.stop()
      }
    })
  })
})
