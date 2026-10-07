import type { Extension } from '@hocuspocus/server'
import * as decoding from 'lib0/decoding'
import * as Y from 'yjs'
import { yDocToProsemirrorJSON } from 'y-prosemirror'
import type { CollabContext } from './server'
import { validateSuggesterChange } from './suggestion-validator'

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
export function permissions(fragmentName: string): Extension<CollabContext> {
  return {
    extensionName: 'permissions',
    async beforeHandleMessage({ update, document, context }) {
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
