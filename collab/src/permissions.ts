import type { Extension } from '@hocuspocus/server'
import * as decoding from 'lib0/decoding'
import * as Y from 'yjs'
import { yDocToProsemirrorJSON } from 'y-prosemirror'
import type { CollabContext } from './server'
import type { Metrics } from './operations'
import { validateSuggesterChange } from './suggestion-validator'
import { architectureLimits, countElements } from './architecture'

const messageSync = 0
const syncStep2 = 1
const syncUpdate = 2

/** The Yjs update inside a raw sync message, or null when the message carries none. */
export function updateOf(raw: Uint8Array): Uint8Array | null {
  const decoder = decoding.createDecoder(raw)
  decoding.readVarString(decoder) // the document name
  if (decoding.readVarUint(decoder) !== messageSync) return null
  const kind = decoding.readVarUint(decoder)
  if (kind !== syncStep2 && kind !== syncUpdate) return null
  return decoding.readVarUint8Array(decoder)
}

/**
 * Someone who may only suggest still writes to the document; what they write is
 * checked here, before it is applied, so it can only be suggestions of their own.
 */
export function permissions(fragmentName: string, metrics?: Metrics): Extension<CollabContext> {
  return {
    extensionName: 'permissions',
    async beforeHandleMessage({ update, document, context, connection }) {
      if (context.documentType === 'architecture') {
        try {
          return checkArchitecture(update, document, context)
        } catch (error) {
          // The connection closes; without the reason the editor would reconnect and send the update again.
          const reason = (error as { reason?: string }).reason ?? 'refused'
          metrics?.refuse(reason)
          connection.sendStateless(JSON.stringify({ type: 'refused', reason }))
          throw error
        }
      }
      if (context.access.canEdit) return
      const incoming = updateOf(update)
      if (!incoming) return
      const copy = new Y.Doc()
      try {
        Y.applyUpdate(copy, Y.encodeStateAsUpdate(document))
        const before = yDocToProsemirrorJSON(copy, fragmentName)
        Y.applyUpdate(copy, incoming)
        const verdict = validateSuggesterChange(before, yDocToProsemirrorJSON(copy, fragmentName), context.userID)
        if (!verdict.ok) {
          if (process.env.COLLAB_DEBUG_REJECT) console.log('REJECT', JSON.stringify({ before, after: yDocToProsemirrorJSON(copy, fragmentName) }))
        }
        if (!verdict.ok) throw Object.assign(new Error(verdict.reason), { reason: verdict.reason })
      } finally {
        copy.destroy()
      }
    },
  }
}

/**
 * A canvas is written only by editors, and never past the element limits: an
 * editor's update is tried on a copy first.
 */
function checkArchitecture(update: Uint8Array, document: Y.Doc, context: CollabContext) {
  const incoming = updateOf(update)
  if (!incoming) return
  // Anyone else has a read-only connection, which drops their updates without closing it.
  if (!context.access.canEdit) return
  // Most updates move or rename something; only one that writes a top-level key can add an element.
  if (!mayAddElements(document, incoming)) return
  const copy = new Y.Doc()
  try {
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(document))
    const before = countElements(copy)
    Y.applyUpdate(copy, incoming)
    const after = countElements(copy)
    // Only growth past a limit is refused, so a document already over it can still shrink.
    const grows = after.nodes > before.nodes || after.connections > before.connections
    if (grows && (after.nodes > architectureLimits.nodes || after.connections > architectureLimits.connections)) {
      throw Object.assign(new Error('too-many-elements'), { reason: 'too-many-elements' })
    }
  } finally {
    copy.destroy()
  }
}

/**
 * Whether an update writes a key of the top-level `nodes` or `connections` map.
 * A new key names its parent; a key written again points at the item it replaces,
 * which is looked up. When that item is not known yet, the answer is yes, so the
 * full check runs.
 */
export function mayAddElements(document: Y.Doc, update: Uint8Array): boolean {
  const roots = new Set<unknown>([document.getMap('nodes'), document.getMap('connections')])
  const { structs } = Y.decodeUpdate(update)
  for (const struct of structs) {
    if (!(struct instanceof Y.Item)) continue
    const parent = struct.parent as unknown
    if (parent === 'nodes' || parent === 'connections') return true
    if (parent !== null || struct.parentSub !== null || !struct.origin) continue
    let replaced: Y.Item | null = null
    try {
      replaced = Y.getItem(document.store, struct.origin) as Y.Item
    } catch {
      return true
    }
    if (roots.has(replaced.parent)) return true
  }
  return false
}
