import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  documentBodyToProseMirror,
  prosemirrorToDocumentBody,
} from '../documentBody'
import { prepareBodyTransaction } from '../prepareBodyTransaction'
import { bodyBuilder } from './testSupport'
import {
  requestFilePicker,
  uploadsPlugin,
  type UploadedFile,
} from './uploads'

const views: EditorView[] = []
afterEach(() => views.splice(0).forEach((view) => view.destroy()))

function mount(options: {
  upload: (file: File) => Promise<UploadedFile>
  enabled?: () => boolean
  onError?: (message: string) => void
  chooseFiles?: () => Promise<File[]>
}) {
  const b = bodyBuilder()
  const root = b.add(null, 'document')
  const p = b.add(root, 'paragraph')
  b.add(p, 'run', 'hello')
  const dom = document.createElement('div')
  document.body.append(dom)
  const state = EditorState.create({
    doc: documentBodyToProseMirror(b.nodes),
    plugins: [
      uploadsPlugin({
        upload: options.upload,
        enabled: options.enabled ?? (() => true),
        onError: options.onError ?? (() => {}),
        chooseFiles: options.chooseFiles,
      }),
    ],
  })
  const view = new EditorView(dom, {
    state,
    dispatchTransaction(transaction) {
      view.updateState(
        view.state.apply(prepareBodyTransaction(view.state, transaction))
      )
    },
  })
  view.dispatch(
    view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(4)))
  )
  views.push(view)
  return view
}

function paste(view: EditorView, ...files: File[]) {
  const event = Object.assign(new Event('paste', { cancelable: true }), {
    clipboardData: { files, getData: () => '', types: ['Files'] },
  }) as unknown as ClipboardEvent
  const handled = view.someProp('handlePaste', (f) =>
    f(view, event, null as never)
  )
  return { handled, event }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function types(view: EditorView) {
  return prosemirrorToDocumentBody(view.state.doc).map((n) => n.type)
}

describe('uploads', () => {
  it('turns a pasted image into an image that points at the stored file', async () => {
    const upload = vi.fn(async (file: File) => ({
      url: '/api/v1/documents/d/assets/a1',
      fileName: file.name,
      contentType: 'image/png',
      inline: true,
    }))
    const view = mount({ upload })
    const file = new File([new Uint8Array([1])], 'logo.png', {
      type: 'image/png',
    })
    const { handled, event } = paste(view, file)
    expect(handled).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    await settle()
    expect(upload).toHaveBeenCalledWith(file)
    const image = prosemirrorToDocumentBody(view.state.doc).find(
      (n) => n.type === 'image'
    )
    expect(image?.attributes).toMatchObject({
      src: '/api/v1/documents/d/assets/a1',
      alt: 'logo.png',
    })
  })

  it('puts a pdf or any other file in a block of its own', async () => {
    const view = mount({
      upload: async (file) => ({
        url: '/api/v1/documents/d/assets/a2',
        fileName: file.name,
        contentType: 'application/pdf',
        inline: true,
      }),
    })
    paste(view, new File(['%PDF'], 'spec.pdf', { type: 'application/pdf' }))
    await settle()
    const attachment = prosemirrorToDocumentBody(view.state.doc).find(
      (n) => n.type === 'attachment'
    )
    expect(attachment?.attributes).toMatchObject({
      src: '/api/v1/documents/d/assets/a2',
      fileName: 'spec.pdf',
      contentType: 'application/pdf',
    })
  })

  it('leaves the page alone and says why when the upload fails', async () => {
    const onError = vi.fn()
    const view = mount({
      upload: async () => {
        throw new Error('file is too large')
      },
      onError,
    })
    const before = types(view)
    paste(view, new File(['x'], 'big.bin'))
    await settle()
    expect(types(view)).toEqual(before)
    expect(onError).toHaveBeenCalledWith('file is too large')
  })

  it('does nothing when the reader may not edit', () => {
    const upload = vi.fn()
    const view = mount({ upload, enabled: () => false })
    const { handled } = paste(view, new File(['x'], 'a.png', { type: 'image/png' }))
    expect(handled).toBeFalsy()
    expect(upload).not.toHaveBeenCalled()
  })

  it('takes files dropped on the page', async () => {
    const upload = vi.fn(async (file: File) => ({
      url: '/api/v1/documents/d/assets/a3',
      fileName: file.name,
      contentType: 'video/mp4',
      inline: true,
    }))
    const view = mount({ upload })
    const file = new File(['v'], 'clip.mp4', { type: 'video/mp4' })
    const event = Object.assign(new Event('drop', { cancelable: true }), {
      dataTransfer: { files: [file] },
      clientX: 0,
      clientY: 0,
    }) as unknown as DragEvent
    const handled = view.someProp('handleDrop', (f) =>
      f(view, event, null as never, false)
    )
    expect(handled).toBe(true)
    await settle()
    expect(upload).toHaveBeenCalledWith(file)
    expect(types(view)).toContain('attachment')
  })

  it('adds the files a person picks from the block menu', async () => {
    const upload = vi.fn(async (file: File) => ({
      url: '/api/v1/documents/d/assets/a4',
      fileName: file.name,
      contentType: 'application/zip',
      inline: false,
    }))
    const file = new File(['z'], 'notes.zip')
    const view = mount({ upload, chooseFiles: async () => [file] })
    expect(requestFilePicker(view.state, (tr) => view.dispatch(tr))).toBe(true)
    await settle()
    expect(upload).toHaveBeenCalledWith(file)
    expect(types(view)).toContain('attachment')
  })

  it('reads a pasted or dropped Markdown file into blocks instead of storing it', async () => {
    const upload = vi.fn()
    const view = mount({ upload })
    const file = new File(['# Imported title\n\nSome body text'], 'notes.md', {
      type: 'text/markdown',
    })
    const { handled } = paste(view, file)
    expect(handled).toBe(true)
    await vi.waitFor(() =>
      expect(
        prosemirrorToDocumentBody(view.state.doc).some(
          (n) => n.type === 'atx-heading'
        )
      ).toBe(true)
    )
    expect(upload).not.toHaveBeenCalled()
    expect(types(view)).not.toContain('attachment')
  })
})
