import * as Y from 'yjs'
import { prosemirrorJSONToYXmlFragment } from 'y-prosemirror'
import { documentBodySchema } from './schema'

const fragmentName = 'body'
// Every build uses this client id, so building twice gives the same operations.
const seedClientID = 0x5eed

/**
 * The Yjs state of a document that only has JSON (a seed, an import). Built the
 * same way every time: a client that kept an earlier copy and meets a rebuilt
 * one would otherwise end up with the document twice.
 */
export function seedFromJSON(content: unknown): Uint8Array {
  const seed = new Y.Doc()
  seed.clientID = seedClientID
  prosemirrorJSONToYXmlFragment(documentBodySchema, content as object, seed.getXmlFragment(fragmentName))
  const state = Y.encodeStateAsUpdate(seed)
  seed.destroy()
  return state
}
