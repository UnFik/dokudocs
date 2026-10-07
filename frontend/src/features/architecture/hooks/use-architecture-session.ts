import { useEffect, useRef, useState } from 'react'
import type * as Y from 'yjs'
import { useAuthStore } from '@/stores/auth-store'
import {
  openCollabSession,
  type CollabAccess,
  type CollabStatus,
  type PresenceUser,
} from '@/features/docs/lib/collab-session'
import { readCanvas } from '../lib/canvas-doc'
import type { ArchitectureJSON } from '../lib/canvas-model'

/** Someone else in the room: what they have selected and where their pointer is on the canvas. */
export type Peer = {
  clientID: number
  userID: string
  name: string
  color: string
  selection: string | null
  pointer: { x: number; y: number } | null
}

type Session = ReturnType<typeof openCollabSession>

const emptyCanvas: ArchitectureJSON = { version: 1, nodes: [], connections: [] }

/**
 * Opens the document's room (same service, local copy and presence as Markdown)
 * and keeps the canvas JSON in step with the Yjs state.
 */
export function useArchitectureSession(input: {
  workspaceID: string
  documentID: string
  userID: string
  userName?: string
  initial: ArchitectureJSON | null
  nonce: number
  onReloaded: () => void
  /** Someone in the room changed the comments. */
  onCommentsChanged?: () => void
}) {
  const [canvas, setCanvas] = useState<ArchitectureJSON>(
    input.initial ?? emptyCanvas
  )
  const [status, setStatus] = useState<CollabStatus>('connecting')
  const [access, setAccess] = useState<CollabAccess | null>(null)
  const [presence, setPresence] = useState<PresenceUser[]>([])
  const [peers, setPeers] = useState<Peer[]>([])
  const [synced, setSynced] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const [doc, setDoc] = useState<Y.Doc | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const reloadedRef = useRef(input.onReloaded)
  reloadedRef.current = input.onReloaded
  const commentsRef = useRef(input.onCommentsChanged)
  commentsRef.current = input.onCommentsChanged

  useEffect(() => {
    const session = openCollabSession({
      workspaceID: input.workspaceID,
      documentID: input.documentID,
      userID: input.userID,
      userName: input.userName,
      token: () => useAuthStore.getState().auth.accessToken,
      onStatus: setStatus,
      onAccess: setAccess,
      onPresence: setPresence,
      onReloaded: () => reloadedRef.current(),
      onCommentsChanged: () => commentsRef.current?.(),
      onRefused: (reason) => {
        setRefused(reason || 'refused')
        // The update stays in this device's copy; without the reason the provider would send it forever.
        session.provider.disconnect()
      },
    })
    sessionRef.current = session
    setDoc(session.ydoc)
    let frame = 0
    const publish = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setCanvas(readCanvas(session.ydoc)))
    }
    session.ydoc.on('update', publish)
    void session.loaded.then(() => {
      if (
        session.ydoc.getMap('nodes').size ||
        session.ydoc.getMap('connections').size
      )
        publish()
    })
    void session.synced.then(() => {
      setSynced(true)
      publish()
    })
    const readPeers = () => {
      const awareness = session.awareness
      if (!awareness) return
      const next: Peer[] = []
      for (const [clientID, state] of awareness.getStates()) {
        if (clientID === session.ydoc.clientID) continue
        const user = state.user as
          | { userID?: string; name?: string; color?: string }
          | undefined
        if (!user?.userID) continue
        next.push({
          clientID,
          userID: user.userID,
          name: user.name ?? 'Someone',
          color: user.color ?? 'currentColor',
          selection:
            typeof state.selection === 'string' ? state.selection : null,
          pointer: (state.pointer as Peer['pointer']) ?? null,
        })
      }
      setPeers(next)
    }
    session.awareness?.on('change', readPeers)
    return () => {
      cancelAnimationFrame(frame)
      session.ydoc.off('update', publish)
      session.awareness?.off('change', readPeers)
      session.destroy()
      sessionRef.current = null
      setDoc(null)
    }
    // A new nonce opens a fresh session (after a restore or a reload from the server).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.workspaceID, input.documentID, input.userID, input.nonce])

  useEffect(() => {
    sessionRef.current?.setUserName(input.userName)
  }, [input.userName])

  return {
    doc,
    canvas,
    status,
    access,
    presence,
    peers,
    synced,
    refused,
    /** Tells the others in the room to read the comments again. */
    signalComments() {
      sessionRef.current?.signalCommentsChanged()
    },
    /** Shares what this person has selected and where their pointer is (canvas coordinates). */
    share(field: 'selection' | 'pointer', value: unknown) {
      sessionRef.current?.awareness?.setLocalStateField(field, value)
    },
  }
}
