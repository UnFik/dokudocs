import katex from 'katex'
import 'katex/dist/contrib/mhchem.mjs'
import 'katex/dist/katex.min.css'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { NodeView, NodeViewConstructor } from 'prosemirror-view'
import './blocks.css'
import { isSafeImageSource } from './mediaCommands'

export interface ImageEditRequest {
  src: string
  alt: string
  position: number
}

export interface MediaNodeViewOptions {
  /** Turns a stored file's address into one the page can load (it needs the session). */
  resolveSource?: (src: string) => Promise<string>
  /** Called when the user asks to edit an image; the host shows its own form. */
  onImageEdit?: (request: ImageEditRequest) => void
}

function bodyAttributes(node: ProseMirrorNode): Record<string, unknown> {
  try {
    return JSON.parse(node.attrs.bodyAttributes as string)
  } catch {
    return {}
  }
}

function applyIdentity(dom: HTMLElement, node: ProseMirrorNode) {
  const nodeID = node.attrs.nodeID as string | null
  if (nodeID) {
    dom.id = `node-${nodeID}`
    dom.dataset.nodeId = nodeID
  }
}

function imageView(options: MediaNodeViewOptions): NodeViewConstructor {
  return (initial, _view, getPos) => {
    const dom = document.createElement('span')
    dom.className = 'dd-image'
    dom.contentEditable = 'false'
    let node = initial
    const render = () => {
      const { src = '', alt = '' } = bodyAttributes(node) as {
        src?: string
        alt?: string
      }
      dom.replaceChildren()
      applyIdentity(dom, node)
      if (isSafeImageSource(src)) {
        const img = document.createElement('img')
        if (options.resolveSource && isStoredFile(src)) {
          void options.resolveSource(src).then(
            (resolved) => {
              img.src = resolved
            },
            () => {
              img.alt = `${alt || 'Image'} could not be loaded`
            }
          )
        } else img.src = src
        img.alt = alt
        img.loading = 'lazy'
        dom.append(img)
      } else {
        const fallback = document.createElement('span')
        fallback.className = 'dd-image-blocked'
        fallback.textContent = alt || 'Image blocked'
        dom.append(fallback)
      }
      if (options.onImageEdit) {
        const edit = document.createElement('button')
        edit.type = 'button'
        edit.dataset.imageEdit = ''
        edit.className = 'dd-image-edit'
        edit.setAttribute('aria-label', 'Edit image')
        edit.textContent = 'edit'
        edit.addEventListener('click', () => {
          const position = getPos()
          if (position !== undefined)
            options.onImageEdit!({ src, alt, position })
        })
        dom.append(edit)
      }
    }
    render()
    return {
      dom,
      update(next) {
        if (next.type !== node.type) return false
        node = next
        render()
        return true
      },
      stopEvent: (event) => event.target instanceof HTMLButtonElement,
      ignoreMutation: () => true,
    } satisfies NodeView
  }
}

function isStoredFile(src: string) {
  return src.startsWith('/api/')
}

function attachmentView(options: MediaNodeViewOptions): NodeViewConstructor {
  return (initial) => {
    const dom = document.createElement('div')
    dom.className = 'dd-attachment'
    dom.contentEditable = 'false'
    let node = initial
    const render = () => {
      const {
        src = '',
        fileName = 'file',
        contentType = '',
      } = bodyAttributes(node) as {
        src?: string
        fileName?: string
        contentType?: string
      }
      dom.replaceChildren()
      applyIdentity(dom, node)
      const resolve = () =>
        options.resolveSource ? options.resolveSource(src) : Promise.resolve(src)
      const media = contentType.startsWith('video/')
        ? document.createElement('video')
        : contentType === 'application/pdf'
          ? document.createElement('iframe')
          : null
      if (media instanceof HTMLVideoElement) {
        media.controls = true
        media.preload = 'metadata'
      }
      if (media instanceof HTMLIFrameElement) {
        media.title = fileName
        media.setAttribute('sandbox', '')
      }
      if (media) {
        void resolve().then(
          (resolved) => media.setAttribute('src', resolved),
          () => media.replaceWith(`${fileName} could not be loaded`)
        )
        dom.append(media)
        return
      }
      const card = document.createElement('div')
      card.className = 'dd-attachment-card'
      const name = document.createElement('span')
      name.textContent = fileName
      const download = document.createElement('button')
      download.type = 'button'
      download.dataset.attachmentDownload = ''
      download.textContent = 'Download'
      download.addEventListener('click', () => {
        void resolve().then((resolved) => {
          const link = document.createElement('a')
          link.href = resolved
          link.download = fileName
          link.click()
        })
      })
      card.append(name, download)
      dom.append(card)
    }
    render()
    return {
      dom,
      update(next) {
        if (next.type !== node.type) return false
        node = next
        render()
        return true
      },
      stopEvent: (event) => event.target instanceof HTMLButtonElement,
      ignoreMutation: () => true,
    } satisfies NodeView
  }
}

function renderMath(target: HTMLElement, source: string, displayMode: boolean) {
  target.replaceChildren()
  delete target.dataset.previewError
  if (!source.trim()) {
    target.textContent = 'empty formula'
    target.dataset.previewEmpty = ''
    return
  }
  try {
    target.innerHTML = katex.renderToString(source, {
      displayMode,
      throwOnError: true,
      trust: false,
    })
  } catch (error) {
    target.dataset.previewError = ''
    target.textContent =
      error instanceof Error ? error.message : 'Invalid formula'
  }
}

function inlineMathView(): NodeViewConstructor {
  return (initial) => {
    const dom = document.createElement('span')
    dom.className = 'dd-math'
    const source = document.createElement('span')
    source.dataset.mathSource = ''
    source.className = 'dd-math-source'
    const preview = document.createElement('span')
    preview.contentEditable = 'false'
    preview.className = 'dd-math-preview'
    preview.dataset.mathPreview = ''
    dom.append(source, preview)
    let node = initial
    applyIdentity(dom, node)
    renderMath(preview, node.textContent, false)
    return {
      dom,
      contentDOM: source,
      update(next) {
        if (next.type !== node.type) return false
        node = next
        applyIdentity(dom, node)
        renderMath(preview, node.textContent, false)
        return true
      },
      ignoreMutation: (mutation) =>
        mutation.type !== 'selection' && !source.contains(mutation.target),
    } satisfies NodeView
  }
}

let mermaidSequence = 0

async function renderMermaid(target: HTMLElement, source: string) {
  const ticket = ++mermaidSequence
  target.dataset.renderTicket = String(ticket)
  try {
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: document.documentElement.classList.contains('dark')
        ? 'dark'
        : 'default',
    })
    const { svg } = await mermaid.render(`dd-mermaid-${ticket}`, source)
    if (target.dataset.renderTicket !== String(ticket)) return
    delete target.dataset.previewError
    target.innerHTML = svg
  } catch (error) {
    document.getElementById(`dd-mermaid-${ticket}`)?.remove()
    if (target.dataset.renderTicket !== String(ticket)) return
    target.dataset.previewError = ''
    target.textContent =
      error instanceof Error ? error.message.split('\n')[0]! : 'Invalid diagram'
  }
}

function blockView(kind: 'math' | 'diagram'): NodeViewConstructor {
  return (initial) => {
    const dom = document.createElement('div')
    dom.className = `dd-block dd-${kind}-block`
    const preview = document.createElement('div')
    preview.contentEditable = 'false'
    preview.className = 'dd-block-preview'
    if (kind === 'diagram') preview.dataset.diagramPreview = ''
    else preview.dataset.mathPreview = ''
    const source = document.createElement('pre')
    source.className = 'dd-block-source'
    dom.append(preview, source)
    let node = initial
    let timer: ReturnType<typeof setTimeout> | undefined
    const render = () => {
      applyIdentity(dom, node)
      const type = bodyAttributes(node).type
      if (kind === 'math') return renderMath(preview, node.textContent, true)
      if (type !== 'mermaid') {
        preview.replaceChildren()
        delete preview.dataset.previewError
        preview.textContent = `${String(type)} diagrams are source only here`
        return
      }
      clearTimeout(timer)
      timer = setTimeout(
        () => void renderMermaid(preview, node.textContent),
        250
      )
    }
    render()
    return {
      dom,
      contentDOM: source,
      update(next) {
        if (next.type !== node.type) return false
        node = next
        render()
        return true
      },
      destroy: () => clearTimeout(timer),
      ignoreMutation: (mutation) =>
        mutation.type !== 'selection' && !source.contains(mutation.target),
    } satisfies NodeView
  }
}

export function mediaNodeViews(options: MediaNodeViewOptions = {}) {
  return {
    image: imageView(options),
    attachment: attachmentView(options),
    math: inlineMathView(),
    math_block: blockView('math'),
    diagram: blockView('diagram'),
  }
}
