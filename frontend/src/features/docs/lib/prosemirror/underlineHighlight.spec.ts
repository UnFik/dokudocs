import { describe, expect, it } from 'vitest'
import { documentBodyToMarkdown } from '../muya/state/documentBodyToMarkdown'
import type { DocumentBodyNode } from '../documentBody'
import { documentBodyToProseMirror, prosemirrorToDocumentBody } from './documentBody'

function body(attributes: Record<string, unknown>): DocumentBodyNode[] {
  return [
    { nodeID: 'root', parentID: null, siblingOrder: 0, type: 'document', content: '', attributes: {} },
    { nodeID: 'p', parentID: 'root', siblingOrder: 0, type: 'paragraph', content: '', attributes: {} },
    { nodeID: 'r', parentID: 'p', siblingOrder: 0, type: 'run', content: 'marked', attributes },
  ]
}

describe('underline and highlight', () => {
  it('are marks in the editor and attributes in the body, both ways', () => {
    const doc = documentBodyToProseMirror(body({ underline: true, highlight: true }))
    const text = doc.firstChild!.firstChild!.firstChild!.firstChild!
    expect(text.marks.map((mark) => mark.type.name).sort()).toEqual(['highlight', 'underline'])

    const again = prosemirrorToDocumentBody(doc).find((node) => node.type === 'run')!
    expect(again.attributes).toMatchObject({ underline: true, highlight: true })
  })

  it('are exported to Markdown as inline HTML', () => {
    expect(documentBodyToMarkdown(body({ underline: true }))).toContain('<u>marked</u>')
    expect(documentBodyToMarkdown(body({ highlight: true }))).toContain('<mark>marked</mark>')
  })
})
