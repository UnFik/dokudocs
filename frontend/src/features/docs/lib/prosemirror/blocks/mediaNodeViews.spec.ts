import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { documentBodyToProseMirror } from '../documentBody'
import { mediaNodeViews } from './mediaNodeViews'
import { bodyBuilder } from './testSupport'

const views: EditorView[] = []
afterEach(() => views.splice(0).forEach((view) => view.destroy()))

function mount(
  build: (b: ReturnType<typeof bodyBuilder>, root: string) => void,
  resolveSource?: (src: string) => Promise<string>
) {
  const b = bodyBuilder()
  const root = b.add(null, 'document')
  build(b, root)
  const dom = document.createElement('div')
  document.body.append(dom)
  const onImageEdit = vi.fn()
  const view = new EditorView(dom, {
    state: EditorState.create({ doc: documentBodyToProseMirror(b.nodes) }),
    nodeViews: mediaNodeViews({ onImageEdit, resolveSource }),
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

  it('loads a stored image through the resolver, not straight from its address', async () => {
    const resolveSource = vi.fn(async () => 'blob:resolved-image')
    const { dom } = mount((b, root) => {
      const p = b.add(root, 'paragraph')
      b.add(p, 'image', '', { src: '/api/v1/documents/d/assets/a', alt: 'x' })
    }, resolveSource)
    await vi.waitFor(() =>
      expect(dom.querySelector('.dd-image img')?.getAttribute('src')).toBe(
        'blob:resolved-image'
      )
    )
    expect(resolveSource).toHaveBeenCalledWith('/api/v1/documents/d/assets/a')
  })

  it('shows an uploaded video with controls', async () => {
    const { dom } = mount(
      (b, root) =>
        b.add(root, 'attachment', '', {
          src: '/api/v1/documents/d/assets/v',
          fileName: 'clip.mp4',
          contentType: 'video/mp4',
        }),
      async () => 'blob:video'
    )
    await vi.waitFor(() =>
      expect(dom.querySelector('video')?.getAttribute('src')).toBe('blob:video')
    )
    expect(dom.querySelector('video')?.controls).toBe(true)
  })

  it('shows a pdf in a frame and any other file as a download card', async () => {
    const pdf = mount(
      (b, root) =>
        b.add(root, 'attachment', '', {
          src: '/api/v1/documents/d/assets/p',
          fileName: 'spec.pdf',
          contentType: 'application/pdf',
        }),
      async () => 'blob:pdf'
    )
    await vi.waitFor(() =>
      expect(pdf.dom.querySelector('iframe')?.getAttribute('src')).toBe(
        'blob:pdf'
      )
    )
    const other = mount(
      (b, root) =>
        b.add(root, 'attachment', '', {
          src: '/api/v1/documents/d/assets/z',
          fileName: 'notes.zip',
          contentType: 'application/zip',
        }),
      async () => 'blob:zip'
    )
    expect(other.dom.textContent).toContain('notes.zip')
    expect(other.dom.querySelector('[data-attachment-download]')).not.toBeNull()
    expect(other.dom.querySelector('iframe, video')).toBeNull()
  })
})
