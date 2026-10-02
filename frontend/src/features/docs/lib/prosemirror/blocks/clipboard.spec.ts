import { Fragment, Slice } from 'prosemirror-model'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { afterEach, describe, expect, it } from 'vitest'
import { documentBodySchema } from '../documentBody'
import { prepareBodyTransaction } from '../prepareBodyTransaction'
import {
  htmlToMarkdownText,
  markdownToSlice,
  pasteFromClipboard,
  sanitizePastedSlice,
  sliceToMarkdown,
} from './clipboard'
import { bodyBuilder, bodyOf, stateFor } from './testSupport'

const views: EditorView[] = []
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy())
})

function mountEmptyParagraph() {
  const b = bodyBuilder()
  const root = b.add(null, 'document')
  const para = b.add(root, 'paragraph')
  const state = stateFor(b.nodes, para)
  const mount = document.createElement('div')
  document.body.append(mount)
  const errors: unknown[] = []
  const view: EditorView = new EditorView(mount, {
    state,
    dispatchTransaction(tr) {
      try {
        const prepared = tr.docChanged
          ? prepareBodyTransaction(view.state, tr)
          : tr
        view.updateState(view.state.apply(prepared))
      } catch (error) {
        errors.push(error)
      }
    },
  })
  views.push(view)
  return { view, errors, para }
}

function clipboard(data: Record<string, string>) {
  const dt = new DataTransfer()
  for (const [type, value] of Object.entries(data)) dt.setData(type, value)
  return dt
}

describe('markdownToSlice', () => {
  it('parses blocks without node IDs', async () => {
    const slice = await markdownToSlice('# Title\n\n- a\n- b\n')
    expect(slice.content.childCount).toBe(2)
    expect(slice.content.child(0).type.name).toBe('atx_heading')
    let ids = 0
    slice.content.descendants((node) => {
      if (node.attrs.nodeID) ids++
    })
    expect(ids).toBe(0)
  })

  it('returns an open inline slice for a single line', async () => {
    const slice = await markdownToSlice('hello **bold**')
    expect(slice.openStart).toBe(1)
    expect(slice.openEnd).toBe(1)
  })
})

describe('sanitizePastedSlice', () => {
  it('strips node IDs so a paste never duplicates one', () => {
    const b = bodyBuilder()
    const root = b.add(null, 'document')
    const para = b.add(root, 'paragraph')
    b.add(para, 'run', 'x')
    const state = stateFor(b.nodes, para)
    const slice = sanitizePastedSlice(
      new Slice(state.doc.child(0).content, 0, 0)
    )
    slice.content.descendants((node) => {
      expect(node.attrs.nodeID ?? null).toBeNull()
    })
  })

  it('turns opaque nodes into plain text instead of creating opaque nodes', () => {
    const opaque = documentBodySchema.nodes.opaque!.create({
      nodeID: 'o1',
      bodyAttributes: '{}',
      bodyContent: '<custom>raw</custom>',
    })
    const slice = sanitizePastedSlice(new Slice(Fragment.from(opaque), 0, 0))
    let opaqueCount = 0
    slice.content.descendants((node) => {
      if (node.type.name === 'opaque') opaqueCount++
    })
    expect(opaqueCount).toBe(0)
    expect(slice.content.textBetween(0, slice.content.size, '\n')).toBe(
      '<custom>raw</custom>'
    )
  })
})

describe('htmlToMarkdownText', () => {
  it('converts Word-style HTML and drops scripts and styles', () => {
    const md = htmlToMarkdownText(
      '<meta charset="utf-8"><style>p{color:red}</style><p class="MsoNormal">A <b>bold</b> <i>claim</i></p><script>alert(1)</script><ul><li>one</li><li>two</li></ul>'
    )
    expect(md).toContain('A **bold** *claim*')
    expect(md).toMatch(/-\s+one/)
    expect(md).not.toContain('alert')
    expect(md).not.toContain('color:red')
  })
})

describe('pasteFromClipboard', () => {
  it('pastes Markdown text as blocks with fresh unique IDs', async () => {
    const { view, errors } = mountEmptyParagraph()
    const handled = await pasteFromClipboard(
      view,
      clipboard({
        'text/plain':
          '# Title\n\n1. a\n2. b\n\n| x | y |\n|---|:-:|\n| 1 | 2 |\n',
      })
    )
    expect(handled).toBe(true)
    expect(errors).toEqual([])
    const body = bodyOf(view.state.doc)
    const types = body.map((n) => n.type)
    expect(types).toContain('atx-heading')
    expect(types).toContain('order-list')
    expect(types).toContain('table')
    expect(new Set(body.map((n) => n.nodeID)).size).toBe(body.length)
    const aligns = body
      .filter((n) => n.type === 'table.cell')
      .map((n) => n.attributes.align)
    expect(aligns).toEqual(['none', 'center', 'none', 'center'])
  })

  it('pastes HTML through Markdown', async () => {
    const { view, errors } = mountEmptyParagraph()
    await pasteFromClipboard(
      view,
      clipboard({ 'text/html': '<h2>Plan</h2><p>Ship <b>it</b></p>' })
    )
    expect(errors).toEqual([])
    const body = bodyOf(view.state.doc)
    expect(
      body.some((n) => n.type === 'atx-heading' && n.attributes.level === 2)
    ).toBe(true)
    expect(
      body.some((n) => n.type === 'run' && n.attributes.bold === true)
    ).toBe(true)
  })

  it('leaves ProseMirror-internal HTML to the default paste', async () => {
    const { view } = mountEmptyParagraph()
    const handled = await pasteFromClipboard(
      view,
      clipboard({
        'text/html': '<p data-pm-slice="1 1 []">x</p>',
        'text/plain': 'x',
      })
    )
    expect(handled).toBe(false)
  })

  it('does nothing when the clipboard has no text', async () => {
    const { view } = mountEmptyParagraph()
    expect(await pasteFromClipboard(view, clipboard({}))).toBe(false)
  })
})

describe('sliceToMarkdown', () => {
  it('serializes selected blocks as Markdown', () => {
    const b = bodyBuilder()
    const root = b.add(null, 'document')
    const h = b.add(root, 'atx-heading', '', { level: 2 })
    b.add(h, 'run', 'Plan')
    const list = b.add(root, 'bullet-list', '', { marker: '-', loose: false })
    const li = b.add(list, 'list-item')
    const p = b.add(li, 'paragraph')
    b.add(p, 'run', 'item', { bold: true })
    const state = stateFor(b.nodes, h)
    const slice = new Slice(state.doc.child(0).content, 0, 0)
    expect(sliceToMarkdown(slice)).toBe('## Plan\n\n- **item**')
  })

  it('serializes an inline selection with its formatting', () => {
    const b = bodyBuilder()
    const root = b.add(null, 'document')
    const p = b.add(root, 'paragraph')
    b.add(p, 'run', 'bold', { bold: true })
    const state = stateFor(b.nodes, p)
    const sel = TextSelection.create(state.doc, 4, 7)
    expect(sliceToMarkdown(state.doc.slice(sel.from, sel.to))).toBe('**old**')
  })

  it('falls back to plain text when the slice is not serializable', () => {
    const slice = new Slice(
      Fragment.from(documentBodySchema.text('plain')),
      0,
      0
    )
    expect(sliceToMarkdown(slice)).toBe('plain')
    expect(EditorState).toBeDefined()
  })
})
