import { DOMSerializer } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { documentBodyToMarkdown } from '../muya/state/documentBodyToMarkdown'
import { documentBodySchema } from './documentBody'
import { mountTestEditor, paragraphsBody, runStart } from './editorTestKit'

function renderedTag(type: string, bodyAttributes: string) {
  const node = documentBodySchema.nodes[type]!.create({
    nodeID: 'heading-1',
    bodyAttributes,
  })
  const dom = DOMSerializer.fromSchema(documentBodySchema).serializeNode(
    node
  ) as HTMLElement
  return dom.tagName.toLowerCase()
}

describe('heading render', () => {
  it.each([1, 2, 3, 4, 5, 6])('renders ATX level %i as h%i', (level) => {
    expect(renderedTag('atx_heading', JSON.stringify({ level }))).toBe(
      `h${level}`
    )
  })

  it.each(['{}', '{"level":0}', '{"level":9}', '{"level":"x"}', 'not json'])(
    'clamps invalid ATX attributes %s into h1-h6',
    (attributes) => {
      expect(renderedTag('atx_heading', attributes)).toMatch(/^h[1-6]$/)
    }
  )

  it('clamps out-of-range levels to the nearest heading', () => {
    expect(renderedTag('atx_heading', '{"level":9}')).toBe('h6')
    expect(renderedTag('atx_heading', '{"level":0}')).toBe('h1')
  })

  it('renders setext headings by level', () => {
    expect(renderedTag('setext_heading', '{"level":1,"underline":"==="}')).toBe(
      'h1'
    )
    expect(renderedTag('setext_heading', '{"level":2,"underline":"---"}')).toBe(
      'h2'
    )
  })
})

describe('heading conversion keeps the Markdown level', () => {
  it.each([1, 2, 3, 4, 5, 6] as const)(
    'exports level %i as # x level',
    (level) => {
      const harness = mountTestEditor(paragraphsBody('Title'))
      try {
        const { view } = harness.editor
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(
              view.state.doc,
              runStart(view.state.doc, 'Title') + 1
            )
          )
        )
        expect(harness.editor.setHeading(level)).toBe(true)
        expect(view.dom.querySelector(`h${level}`)?.textContent).toBe('Title')
        expect(documentBodyToMarkdown(harness.editor.getBody())).toContain(
          `${'#'.repeat(level)} Title`
        )
        expect(harness.editor.setHeading(0)).toBe(true)
        expect(view.dom.querySelector('p')?.textContent).toBe('Title')
        expect(documentBodyToMarkdown(harness.editor.getBody())).not.toContain(
          '#'
        )
      } finally {
        harness.cleanup()
      }
    }
  )
})
