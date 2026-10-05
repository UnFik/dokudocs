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
    },
  })
  const awareness = provider.awareness
  awareness?.setLocalStateField('user', {
    userID: input.userID,
    name: input.userName ?? 'Someone',
    color: authorColor(input.userID),
  })
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

  return {
    ydoc,
    provider,
    awareness,
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
