import { describe, expect, it } from 'vitest'
import type { DocumentBodyNode } from '../documentBody'
import { documentBodyToMarkdown } from '../muya/state/documentBodyToMarkdown'
import {
  documentBodyToProseMirror,
  prosemirrorToDocumentBody,
} from './documentBody'

let order = 0
const node = (
  nodeID: string,
  parentID: string | null,
  type: string,
  content = '',
  attributes: Record<string, unknown> = {}
): DocumentBodyNode => ({
  nodeID,
  parentID,
  siblingOrder: order++,
  type,
  content,
  attributes,
})

function body(kind: string, id: string, label: string): DocumentBodyNode[] {
  order = 0
  return [
    node('root', null, 'document'),
    node('p', 'root', 'paragraph'),
    node('r', 'p', 'run', 'See '),
    node('m', 'p', 'mention', '', { kind, id, label }),
  ]
}

describe('mentions', () => {
  it('are inline atoms that keep what they point to, both ways', () => {
    const doc = documentBodyToProseMirror(body('person', 'u-1', 'Rina'))
    const paragraph = doc.firstChild!.firstChild!
    expect(paragraph.lastChild!.type.name).toBe('mention')
    const again = prosemirrorToDocumentBody(doc).find(
      (item) => item.type === 'mention'
    )!
    expect(again.attributes).toEqual({
      kind: 'person',
      id: 'u-1',
      label: 'Rina',
    })
  })

  it('show their label as an @ chip', () => {
    const doc = documentBodyToProseMirror(body('person', 'u-1', 'Rina'))
    const dom = doc.firstChild!.firstChild!.lastChild!.type.spec.toDOM!(
      doc.firstChild!.firstChild!.lastChild!
    ) as unknown
    expect(JSON.stringify(dom)).toContain('@Rina')
    expect(JSON.stringify(dom)).toContain('dd-mention')
  })

  it.each([
    ['person', 'u-1', 'Rina', 'See @Rina'],
    [
      'document',
      '11111111-1111-4111-8111-111111111111',
      'Launch plan',
      'See [Launch plan](/docs/11111111-1111-4111-8111-111111111111)',
    ],
    [
      'project',
      '22222222-2222-4222-8222-222222222222',
      'Apollo',
      'See [Apollo](/projects/22222222-2222-4222-8222-222222222222)',
    ],
  ])('export a %s mention to Markdown', (kind, id, label, expected) => {
    expect(documentBodyToMarkdown(body(kind, id, label)).trim()).toBe(expected)
  })
})
