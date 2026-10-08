import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { yDocToProsemirrorJSON } from 'y-prosemirror'
import { seedFromJSON } from '../src/seed'
import { documentBodySchema } from '../src/schema'

function content() {
  const attrs = (id: string) => ({ nodeID: id, bodyAttributes: '{}', bodyContent: '' })
  const nodes = documentBodySchema.nodes
  const run = nodes.run!.create(attrs('r'), [documentBodySchema.text('hello')])
  const paragraph = nodes.paragraph!.create(attrs('p'), [run])
  const root = nodes.document!.create(attrs('root'), [paragraph])
  return documentBodySchema.topNodeType.create(null, [root]).toJSON()
}

// A room that is rebuilt from JSON must come out the same every time: a client
// that kept an earlier copy would otherwise merge two copies of the document.
describe('building a document from its JSON', () => {
  it('gives the same state every time', () => {
    expect(seedFromJSON(content())).toEqual(seedFromJSON(content()))
  })

  it('is the document it was built from', () => {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, seedFromJSON(content()))
    expect(yDocToProsemirrorJSON(doc, 'body')).toEqual(content())
  })

  it('does not double the document when two copies meet', () => {
    const left = new Y.Doc()
    const right = new Y.Doc()
    Y.applyUpdate(left, seedFromJSON(content()))
    Y.applyUpdate(right, seedFromJSON(content()))
    Y.applyUpdate(left, Y.encodeStateAsUpdate(right))
    expect(yDocToProsemirrorJSON(left, 'body')).toEqual(content())
  })
})
