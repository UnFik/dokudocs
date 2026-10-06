import { HocuspocusProvider } from '@hocuspocus/provider'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'
import { authorColor } from './author-color'

export type CollabStatus =
  | 'connecting'
  | 'ready'
  | 'offline'
  | 'unauthorized'
  | 'forbidden'

export type CollabAccess = { canEdit: boolean; canSuggest: boolean }

/** A collaborator's selection. Only name and color are shared, never contact data. */
export type RemoteCursor = {
  connectionID: string
  userID: string
  name?: string
  color?: string
  anchor?: Uint8Array
  head?: Uint8Array
}

export type PresenceUser = {
  userID: string
  name?: string
  avatarURL?: string
}

/** A room is named `{workspaceID}.{documentID}`. */
export function roomName(workspaceID: string, documentID: string) {
  return `${workspaceID}.${documentID}`
}

/** The collaboration service sits behind the same origin, under `/collab`. */
export function collabURL(baseURL = window.location.href) {
  const url = new URL('/collab', baseURL)
  if (url.protocol === 'https:') url.protocol = 'wss:'
  else if (url.protocol === 'http:') url.protocol = 'ws:'
  else throw new Error('collaboration requires an HTTP(S) origin')
  return url.href
}

/** Drops this device's copy of a document, for when the server replaced the body. */
export function clearLocalCopy(workspaceID: string, documentID: string) {
  return new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(
      `dokudocs:${roomName(workspaceID, documentID)}`
    )
    request.onsuccess = request.onerror = request.onblocked = () => resolve()
  })
}

/** Whether this device holds a copy of the document, so it can open without a connection. */
export async function hasLocalCopy(workspaceID: string, documentID: string) {
  const name = `dokudocs:${roomName(workspaceID, documentID)}`
  const databases = await indexedDB.databases()
  return databases.some((database) => database.name === name)
}

export function openCollabSession(input: {
  workspaceID: string
  documentID: string
  userID: string
  userName?: string
  token: string | (() => string)
  url?: string
  onStatus?: (status: CollabStatus) => void
  onAccess?: (access: CollabAccess) => void
  onPresence?: (users: PresenceUser[]) => void
  onCursors?: (cursors: RemoteCursor[]) => void
  onCommentsChanged?: () => void
  /** The server replaced the document (a restored revision): this device's copy is stale. */
  onReloaded?: () => void
}) {
  const name = roomName(input.workspaceID, input.documentID)
  const ydoc = new Y.Doc()
  // The local copy makes the document open offline and keeps unsynced edits
  // across a reload; the server merges them in when the connection returns.
  const persistence = new IndexeddbPersistence(`dokudocs:${name}`, ydoc)
  const loaded = persistence.whenSynced.then(() => undefined)
  let status: CollabStatus = 'connecting'
  let markSynced = () => {}
  const synced = new Promise<void>((resolve) => (markSynced = resolve))
  const setStatus = (next: CollabStatus) => {
    if (status === 'unauthorized' || status === 'forbidden') return
    status = next
    input.onStatus?.(next)
  }
  const provider = new HocuspocusProvider({
    url: input.url ?? collabURL(),
    name,
    document: ydoc,
    token: input.token,
    onStatus: ({ status: next }) => {
      connected = next === 'connected'
      if (next === 'connected') setStatus('ready')
      else if (next === 'connecting') setStatus('connecting')
      else setStatus('offline')
    },
    onAuthenticationFailed: ({ reason }) => {
      status = reason === 'forbidden' ? 'forbidden' : 'unauthorized'
      input.onStatus?.(status)
      markSynced()
    },
    onSynced: () => markSynced(),
    onStateless: ({ payload }) => {
      let message: { type?: string } & Partial<CollabAccess>
      try {
        message = JSON.parse(payload)
      } catch {
        return
      }
      if (message.type === 'access')
        input.onAccess?.({
          canEdit: Boolean(message.canEdit),
          canSuggest: Boolean(message.canSuggest),
        })
      else if (message.type === 'comments_changed') input.onCommentsChanged?.()
      else if (message.type === 'reloaded') input.onReloaded?.()
    },
  })
  // A change made while the connection is down is not on the server until the
  // connection is back and the provider has had it acknowledged.
  let wroteOffline = false
  let connected = false
  ydoc.on('update', (_update: Uint8Array, origin: unknown) => {
    if (origin !== provider && !connected) wroteOffline = true
  })
  provider.on('unsyncedChanges', ({ number }: { number: number }) => {
    if (number === 0 && connected) wroteOffline = false
  })
  const awareness = provider.awareness
  const announce = (userName: string | undefined) =>
    awareness?.setLocalStateField('user', {
      userID: input.userID,
      name: userName || 'Someone',
      color: authorColor(input.userID),
    })
  announce(input.userName)
  const publishPresence = () => {
    if (!awareness) return
    const cursors: RemoteCursor[] = []
    for (const [clientID, state] of awareness.getStates()) {
      if (clientID === ydoc.clientID) continue
      const user = state.user as
        | { userID?: string; name?: string; color?: string }
        | undefined
      const cursor = state.cursor as
        | { anchor?: Uint8Array; head?: Uint8Array }
        | undefined
      if (!user?.userID || !cursor?.anchor || !cursor.head) continue
      cursors.push({
        connectionID: String(clientID),
        userID: user.userID,
        name: user.name,
        color: user.color,
        anchor: cursor.anchor,
        head: cursor.head,
      })
    }
    input.onCursors?.(cursors)
    if (!input.onPresence) return
    const seen = new Map<string, PresenceUser>()
    for (const state of awareness.getStates().values()) {
      const user = state.user as { userID?: string; name?: string } | undefined
      if (user?.userID && !seen.has(user.userID))
        seen.set(user.userID, { userID: user.userID, name: user.name })
    }
    input.onPresence([...seen.values()])
  }
  awareness?.on('change', publishPresence)
  publishPresence()

  return {
    ydoc,
    provider,
    awareness,
    /** The name the others see next to this person's cursor and in the people list. */
    setUserName: announce,
    /** Tells the others in the room that the comments changed. */
    signalCommentsChanged() {
      provider.sendStateless(JSON.stringify({ type: 'comments_changed' }))
    },
    unsyncedChanges: () =>
      Math.max(provider.unsyncedChanges, wroteOffline ? 1 : 0),
    /** Resolves true once the server has every change made here, false at the timeout. */
    drained(timeoutMs: number) {
      const settled = () => provider.unsyncedChanges === 0 && !wroteOffline
      if (settled()) return Promise.resolve(true)
      return new Promise<boolean>((resolve) => {
        const finish = (value: boolean) => {
          clearTimeout(timer)
          clearInterval(poll)
          resolve(value)
        }
        const timer = setTimeout(() => finish(false), timeoutMs)
        const poll = setInterval(() => {
          if (settled()) finish(true)
        }, 50)
      })
    },
    /** Shares the local selection, or clears it when the editor loses focus. */
    setCursor(selection: { anchor: Uint8Array; head: Uint8Array } | null) {
      awareness?.setLocalStateField('cursor', selection)
    },
    /** The server and this copy agree for the first time. */
    synced,
    /** The local copy is read: the editor can show the document. */
    loaded,
    destroy() {
      awareness?.off('change', publishPresence)
      provider.destroy()
      void persistence.destroy()
      ydoc.destroy()
    },
  }
}
