import { useEffect, useRef, useState } from 'react'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import { useAuthStore } from '@/stores/auth-store'
import { getUserStorage } from '@/lib/user-storage'
import { registerOpenDocument } from '../lib/collab-registry'
import {
  clearLocalCopy,
  openCollabSession,
  roomName,
  type CollabAccess,
  type CollabStatus,
  type PresenceUser,
} from '../lib/collab-session'
import { saveRecoveryCopy } from '../lib/recovery-copies'

type Session = ReturnType<typeof openCollabSession>

/** Whether the database holds this person's latest edits. */
export type SaveState = 'saved' | 'saving' | 'offline' | 'failed'

const saveDelayMs = 1000
const flushTimeoutMs = 10_000

// A copy with edits the database has not confirmed. Kept across a reload, so a
// restore met after a cold offline start still keeps them as a recovery copy.
// Under `dokudocs:` like the copies themselves, so sign-out clears both together.
const unsavedKey = (room: string) => `dokudocs:unsaved:${room}`

// The access last granted, so a reload without a connection keeps its mode.
const accessKey = (room: string) => `dokudocs:access:${room}`

function cachedAccess(room: string): CollabAccess | null {
  try {
    const raw = getUserStorage().getItem(accessKey(room))
    return raw ? (JSON.parse(raw) as CollabAccess) : null
  } catch {
    return null
  }
}

function markUnsaved(room: string, unsaved: boolean) {
  const storage = getUserStorage()
  if (unsaved) storage.setItem(unsavedKey(room), '1')
  else storage.removeItem(unsavedKey(room))
}

/**
 * Opens a DBML or Mermaid document's room on its record (ADR 0033): the shared
 * source text, presence, this device's copy, and whether edits are saved. When a
 * restore replaces the record, unsaved source is kept as a recovery copy and
 * `onReplaced` is called so the editor reopens on the current record.
 */
export function useSourceSession(input: {
  workspaceID: string
  documentID: string
  record: string
  userID: string
  userName?: string
  title: string
  onReplaced: () => void
  /** Someone else changed the comments of this document. */
  onCommentsChanged?: () => void
}) {
  const [text, setText] = useState<Y.Text | null>(null)
  const [awareness, setAwareness] = useState<Awareness | null>(null)
  const [source, setSource] = useState('')
  const [status, setStatus] = useState<CollabStatus>('connecting')
  const [access, setAccess] = useState<CollabAccess | null>(null)
  const [presence, setPresence] = useState<PresenceUser[]>([])
  const [synced, setSynced] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const replaceRef = useRef<() => void>(() => {})
  const latest = useRef(input)
  useEffect(() => {
    latest.current = input
  })

  useEffect(() => {
    const room = roomName(input.workspaceID, input.documentID, input.record)
    let replaced = false
    // Keeps the source this device never got stored, then opens the current record.
    const replace = () => {
      if (replaced) return
      replaced = true
      const session = sessionRef.current
      const unsaved = getUserStorage().getItem(unsavedKey(room)) === '1'
      if (session && unsaved)
        saveRecoveryCopy({
          workspaceID: input.workspaceID,
          documentID: input.documentID,
          record: input.record,
          title: latest.current.title,
          source: session.ydoc.getText('source').toString(),
          savedAt: new Date().toISOString(),
        })
      markUnsaved(room, false)
      session?.destroy()
      sessionRef.current = null
      void clearLocalCopy(
        input.workspaceID,
        input.documentID,
        input.record
      ).then(() => latest.current.onReplaced())
    }

    const session = openCollabSession({
      workspaceID: input.workspaceID,
      documentID: input.documentID,
      record: input.record,
      userID: input.userID,
      userName: input.userName,
      token: () => useAuthStore.getState().auth.accessToken,
      onStatus: (next) => {
        if (next === 'replaced') replace()
        else setStatus(next)
      },
      onAccess: (next) => {
        setAccess(next)
        getUserStorage().setItem(accessKey(room), JSON.stringify(next))
      },
      onPresence: setPresence,
      onCommentsChanged: () => latest.current.onCommentsChanged?.(),
      // The room closed for a restore; reconnecting is refused as replaced, but
      // there is no need to wait for that.
      onReloaded: replace,
      onRefused: (reason) => {
        if (reason === 'replaced') replace()
        else setStatus(reason === 'forbidden' ? 'forbidden' : 'unauthorized')
      },
    })
    sessionRef.current = session
    replaceRef.current = replace
    setAccess(cachedAccess(room))
    const shared = session.ydoc.getText('source')
    setText(shared)
    setAwareness(session.awareness ?? null)

    // The preview follows the text on the next frame; typing stays on the shared text.
    let frame = 0
    const publish = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setSource(shared.toString()))
    }
    shared.observe(publish)
    void session.loaded.then(publish)

    // Saved means the database has it, not just the room (`flushed`).
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    let edits = 0
    const save = async () => {
      const at = edits
      const ok = await session.flushed(flushTimeoutMs)
      if (sessionRef.current !== session) return
      if (ok && at === edits) {
        markUnsaved(room, false)
        setSaveState('saved')
        setLastSaved(new Date())
      } else if (!ok) {
        setSaveState(navigator.onLine ? 'failed' : 'offline')
      }
    }
    // Reading this device's copy writes too; only what happens after it is an edit.
    let loaded = false
    void session.loaded.then(() => (loaded = true))
    const onUpdate = (_update: Uint8Array, origin: unknown) => {
      if (!loaded || origin === session.provider) return
      edits++
      markUnsaved(room, true)
      setSaveState(navigator.onLine ? 'saving' : 'offline')
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => void save(), saveDelayMs)
    }
    session.ydoc.on('update', onUpdate)
    void session.synced.then(() => {
      if (sessionRef.current !== session) return
      setSynced(true)
      // Edits kept on this device from before reach the database now.
      if (getUserStorage().getItem(unsavedKey(room)) === '1') void save()
    })

    const unregister = registerOpenDocument({
      userID: input.userID,
      documentID: input.documentID,
      workspaceID: input.workspaceID,
      unsyncedChanges: session.unsyncedChanges,
      drained: (timeoutMs) => session.drained(timeoutMs),
      markdown: () => shared.toString(),
      destroy: () => session.destroy(),
    })

    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(saveTimer)
      unregister()
      shared.unobserve(publish)
      session.ydoc.off('update', onUpdate)
      if (sessionRef.current === session) {
        session.destroy()
        sessionRef.current = null
      }
      setText(null)
      setAwareness(null)
    }
    // A new record opens a fresh session; the name is announced by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.workspaceID, input.documentID, input.record, input.userID])

  useEffect(() => {
    sessionRef.current?.setUserName(input.userName)
  }, [input.userName])

  return {
    text,
    awareness,
    /** The source as last rendered, for the preview and exports. */
    source,
    status,
    access,
    presence,
    synced,
    saveState,
    lastSaved,
    /** Tells the others in the room that this person changed the comments. */
    signalComments: () => sessionRef.current?.signalCommentsChanged(),
    /** After this person restored a revision: keep unsaved source and open the new record. */
    reopen: () => replaceRef.current(),
    /** Resolves true once the database holds every edit made here. */
    flushed: (timeoutMs = flushTimeoutMs) =>
      sessionRef.current?.flushed(timeoutMs) ?? Promise.resolve(false),
  }
}
