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

function body(): DocumentBodyNode[] {
  order = 0
  return [
    node('root', null, 'document'),
    node('n', 'root', 'notice', '', { variant: 'warning' }),
    node('np', 'n', 'paragraph'),
    node('nr', 'np', 'run', 'Careful here'),
    node('t', 'root', 'toggle'),
    node('th', 't', 'atx-heading', '', { level: 2 }),
    node('thr', 'th', 'run', 'More'),
    node('tp', 't', 'paragraph'),
    node('tpr', 'tp', 'run', 'Hidden text'),
    node('pb', 'root', 'page-break'),
  ]
}

describe('notice, toggle and page break', () => {
  it('round trip between the body and the editor document', () => {
    const doc = documentBodyToProseMirror(body())
    const types = [...Array(doc.firstChild!.childCount).keys()].map(
      (index) => doc.firstChild!.child(index).type.name
    )
    expect(types).toEqual(['notice', 'toggle', 'page_break'])
    const again = prosemirrorToDocumentBody(doc)
    expect(
      again.find((item) => item.type === 'notice')!.attributes
    ).toMatchObject({ variant: 'warning' })
    expect(
      again.filter((item) => ['toggle', 'page-break'].includes(item.type))
    ).toHaveLength(2)
  })

  it('export to Markdown as fenced containers and an HTML page break', () => {
    expect(documentBodyToMarkdown(body())).toBe(
      [
        ':::warning',
        'Careful here',
        ':::',
        '',
        '+++',
        '## More',
        '',
        'Hidden text',
        '+++',
        '',
        '<div class="page-break"></div>',
        '',
      ].join('\n')
    )
  })
})
