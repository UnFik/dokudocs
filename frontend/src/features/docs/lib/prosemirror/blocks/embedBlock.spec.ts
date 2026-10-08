import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import {
  documentBodyToProseMirror,
  prosemirrorToDocumentBody,
} from '../documentBody'
import { prepareBodyTransaction } from '../prepareBodyTransaction'
import { embedPlugin, embedView } from './embedBlock'
import { bodyBuilder } from './testSupport'

const views: EditorView[] = []
afterEach(() => views.splice(0).forEach((view) => view.destroy()))

function mount(text: string) {
  const b = bodyBuilder()
  const root = b.add(null, 'document')
  const p = b.add(root, 'paragraph')
  if (text) b.add(p, 'run', text)
  const dom = document.createElement('div')
  document.body.append(dom)
  const view = new EditorView(dom, {
    state: EditorState.create({
      doc: documentBodyToProseMirror(b.nodes),
      plugins: [embedPlugin()],
    }),
    nodeViews: { embed: embedView },
    dispatchTransaction(tr) {
      view.updateState(view.state.apply(prepareBodyTransaction(view.state, tr)))
    },
  })
  view.dispatch(
    view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(1)))
  )
  views.push(view)
  return { view, dom }
}

function paste(view: EditorView, text: string) {
  const event = Object.assign(new Event('paste', { cancelable: true }), {
    clipboardData: { files: [], getData: () => text, types: ['text/plain'] },
  }) as unknown as ClipboardEvent
  return view.someProp('handlePaste', (f) => f(view, event, null as never))
}

describe('embed block', () => {
  it('turns a known address pasted into an empty line into a framed embed', () => {
    const { view, dom } = mount('')
    expect(paste(view, 'https://youtu.be/dQw4w9WgXcQ')).toBe(true)
    const embed = prosemirrorToDocumentBody(view.state.doc).find(
      (n) => n.type === 'embed'
    )
    expect(embed?.attributes).toMatchObject({
      url: 'https://youtu.be/dQw4w9WgXcQ',
      provider: 'youtube',
    })
    const frame = dom.querySelector('iframe')!
    expect(frame.getAttribute('src')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'
    )
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-top-navigation')
  })

  it('leaves other pastes alone', () => {
    const { view } = mount('')
    expect(paste(view, 'https://example.com/page')).toBeFalsy()
    expect(paste(view, 'just words')).toBeFalsy()
  })

  it('does not take over a line that already has text', () => {
    const { view } = mount('see ')
    expect(paste(view, 'https://youtu.be/dQw4w9WgXcQ')).toBeFalsy()
  })

  it('frames only what the registry resolves, whatever the document says', () => {
    const b = bodyBuilder()
    const root = b.add(null, 'document')
    b.add(root, 'embed', '', {
      url: 'https://evil.test/x',
      provider: 'youtube',
      src: 'https://evil.test/x',
    })
    const dom = document.createElement('div')
    document.body.append(dom)
    const view = new EditorView(dom, {
      state: EditorState.create({ doc: documentBodyToProseMirror(b.nodes) }),
      nodeViews: { embed: embedView },
    })
    views.push(view)
    expect(dom.querySelector('iframe')).toBeNull()
    expect(dom.textContent).toContain('https://evil.test/x')
  })
})
