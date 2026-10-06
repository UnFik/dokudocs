import { describe, expect, it } from 'vitest'
import type { DocumentBodyNode } from '../documentBody'
import './blocks/blocks.css'
import { mountTestEditor } from './editorTestKit'
import { headingNumbers } from './headingMargin'

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
  const out = [node('root', null, 'document')]
  const heading = (id: string, level: number, text: string) => {
    out.push(
      node(id, 'root', 'atx-heading', '', { level }),
      node(`${id}r`, id, 'run', text)
    )
  }
  heading('a', 1, 'One')
  heading('b', 2, 'One.One')
  heading('c', 2, 'One.Two')
  heading('d', 3, 'One.Two.One')
  heading('e', 1, 'Two')
  heading('f', 2, 'Two.One')
  return out
}

const label = (element: Element) =>
  getComputedStyle(element, '::before')
    .content.replaceAll('"', '')
    .split('/')[0]!
    .trim()

describe('headingNumbers', () => {
  it('numbers sections, restarting below each higher heading', () => {
    expect(headingNumbers([1, 2, 2, 3, 1, 2])).toEqual([
      '1',
      '1.1',
      '1.2',
      '1.2.1',
      '2',
      '2.1',
    ])
  })

  it('numbers a heading that starts below a missing parent from what exists', () => {
    expect(headingNumbers([2, 3, 2])).toEqual(['1', '1.1', '2'])
  })
})

// Headings can be numbered 1, 1.1, 1.2 ... as a reading aid; it is not in the text.
describe('numbered headings', () => {
  it('number by section when turned on', () => {
    const harness = mountTestEditor(body())
    try {
      harness.editor.setNumberHeadings(true)
      const headings = [
        ...harness.editor.view.dom.querySelectorAll('h1, h2, h3'),
      ]
      expect(headings.map(label)).toEqual([
        '1',
        '1.1',
        '1.2',
        '1.2.1',
        '2',
        '2.1',
      ])
    } finally {
      harness.cleanup()
    }
  })

  it('show no numbers when off, and leave the text alone', () => {
    const harness = mountTestEditor(body())
    try {
      const heading = harness.editor.view.dom.querySelector('h1')!
      expect(['', 'none', 'normal']).toContain(label(heading))
      harness.editor.setNumberHeadings(true)
      expect(heading.textContent).toBe('One')
      harness.editor.setNumberHeadings(false)
      expect(['', 'none', 'normal']).toContain(label(heading))
    } finally {
      harness.cleanup()
    }
  })
})
