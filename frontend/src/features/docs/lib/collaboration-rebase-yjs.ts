import { updateYFragment } from 'y-prosemirror'
import * as Y from 'yjs'
import type { DocumentBodyNode } from './documentBody'
import { documentBodyToProseMirror } from './prosemirror/documentBody'

/**
 * Expresses `merged` as a Yjs update on top of `canonicalState`. Nodes that did
 * not change keep their Yjs identity, so the update is safe at the canonical
 * epoch and never touches content other collaborators already own.
 */
export function buildRebaseUpdate(
  canonicalState: Uint8Array,
  merged: DocumentBodyNode[]
): Uint8Array {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, canonicalState)
    const before = Y.encodeStateVector(doc)
    const fragment = doc.getXmlFragment('body')
    doc.transact(() => {
      updateYFragment(doc, fragment, documentBodyToProseMirror(merged), {
        mapping: new Map(),
        isOMark: new Map(),
      })
    })
    return Y.encodeStateAsUpdate(doc, before)
  } finally {
    doc.destroy()
  }
}
