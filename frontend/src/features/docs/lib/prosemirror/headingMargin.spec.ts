import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { bodyBuilder } from './blocks/testSupport'
import { documentBodyToProseMirror } from './documentBody'
import { headingMarginPlugin } from './headingMargin'

const views: EditorView[] = []
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy())
  document.body.replaceChildren()
})

function mount(onLink = (_nodeID: string) => {}) {
  const b = bodyBuilder()
  const root = b.add(null, 'document')
  const h2 = b.add(root, 'atx-heading', '', { level: 2 })
  b.add(h2, 'run', 'Section')
  const p = b.add(root, 'paragraph')
  b.add(p, 'run', 'text')
  const h4 = b.add(root, 'atx-heading', '', { level: 4 })
  b.add(h4, 'run', 'Deep')
  const host = document.createElement('div')
  document.body.append(host)
  const view = new EditorView(host, {
    state: EditorState.create({
      doc: documentBodyToProseMirror(b.nodes),
      plugins: [headingMarginPlugin(onLink)],
    }),
  })
  views.push(view)
  return { view, host, ids: { h2, h4 } }
}

describe('heading labels and links', () => {
  it('shows the level of each heading in the margin and nothing for a paragraph', () => {
    const { host } = mount()
    const labels = [...host.querySelectorAll('[data-heading-level]')].map(
      (heading) => heading.getAttribute('data-heading-level')
    )
    expect(labels).toEqual(['H2', 'H4'])
  })

  it('gives each heading a button that names the link to it', () => {
    const links: string[] = []
    const { host, ids } = mount((nodeID) => links.push(nodeID))
    const anchors =
      host.querySelectorAll<HTMLButtonElement>('.dd-heading-anchor')
    expect(anchors).toHaveLength(2)
    expect(anchors[0]!.getAttribute('aria-label')).toBe('Copy link to heading')

    anchors[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(links).toEqual([ids.h4])
  })

  it('adds no text to the headings', () => {
    const { host } = mount()
    expect(host.querySelector('h2')?.textContent).toBe('Section')
    expect(host.querySelector('h4')?.textContent).toBe('Deep')
  })
})
