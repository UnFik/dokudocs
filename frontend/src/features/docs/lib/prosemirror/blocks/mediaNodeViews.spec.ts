import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { documentBodyToProseMirror } from '../documentBody'
import { mediaNodeViews } from './mediaNodeViews'
import { bodyBuilder } from './testSupport'

const views: EditorView[] = []
afterEach(() => views.splice(0).forEach((view) => view.destroy()))

function mount(
  build: (b: ReturnType<typeof bodyBuilder>, root: string) => void
) {
  const b = bodyBuilder()
  const root = b.add(null, 'document')
  build(b, root)
  const dom = document.createElement('div')
  document.body.append(dom)
  const onImageEdit = vi.fn()
  const view = new EditorView(dom, {
    state: EditorState.create({ doc: documentBodyToProseMirror(b.nodes) }),
    nodeViews: mediaNodeViews({ onImageEdit }),
  })
  views.push(view)
  return { view, dom, onImageEdit }
}

describe('media node views', () => {
  it('renders an image with its alt text and exposes an edit action', () => {
    const { dom, onImageEdit } = mount((b, root) => {
      const p = b.add(root, 'paragraph')
      b.add(p, 'image', '', { src: '/a.png', alt: 'logo' })
    })
    const img = dom.querySelector('.dd-image img')!
    expect(img.getAttribute('src')).toBe('/a.png')
    expect(img.getAttribute('alt')).toBe('logo')
    const button = dom.querySelector<HTMLButtonElement>(
      'button[data-image-edit]'
    )!
    expect(button.getAttribute('aria-label')).toBe('Edit image')
    button.click()
    expect(onImageEdit).toHaveBeenCalledOnce()
    expect(onImageEdit.mock.calls[0]![0]).toMatchObject({
      src: '/a.png',
      alt: 'logo',
    })
  })

  it('does not load an unsafe image source', () => {
    const { dom } = mount((b, root) => {
      const p = b.add(root, 'paragraph')
      b.add(p, 'image', '', { src: 'javascript:alert(1)', alt: 'bad' })
    })
    expect(dom.querySelector('.dd-image img')).toBeNull()
    expect(dom.textContent).toContain('bad')
  })

  it('renders inline math with KaTeX next to the editable source', () => {
    const { dom } = mount((b, root) => {
      const p = b.add(root, 'paragraph')
      b.add(p, 'math', 'x^2', { marker: '$' })
    })
    expect(dom.querySelector('.katex')).not.toBeNull()
    expect(dom.querySelector('[data-math-source]')?.textContent).toBe('x^2')
  })

  it('renders a math block and shows an error for invalid TeX', () => {
    const { dom } = mount((b, root) => {
      b.add(root, 'math-block', '\\frac{', { mathStyle: '' })
    })
    expect(dom.querySelector('[data-preview-error]')).not.toBeNull()
  })

  it('renders a mermaid diagram preview and keeps the source editable', async () => {
    const { dom } = mount((b, root) => {
      b.add(root, 'diagram', 'graph TD\n  A --> B', {
        type: 'mermaid',
        lang: 'yaml',
      })
    })
    await vi.waitFor(
      () =>
        expect(dom.querySelector('[data-diagram-preview] svg')).not.toBeNull(),
      { timeout: 8000 }
    )
    expect(dom.querySelector('pre')?.textContent).toContain('A --> B')
  })

  it('marks unsupported diagram types as source-only', () => {
    const { dom } = mount((b, root) => {
      b.add(root, 'diagram', 'a->b', { type: 'sequence', lang: 'yaml' })
    })
    expect(dom.querySelector('[data-diagram-preview]')?.textContent).toContain(
      'source only'
    )
  })
})
