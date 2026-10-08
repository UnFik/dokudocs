import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { describe, expect, it } from 'vitest'
import {
  prosemirrorToYDoc,
  yDocToProsemirrorJSON,
  ySyncPlugin,
  yUndoPluginKey,
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror'
import * as Y from 'yjs'
import type { DocumentBodyNode } from '../documentBody'
import { createDocumentBodyEditor } from './createDocumentBodyEditor'
import {
  documentBodySchema,
  documentBodyToProseMirror,
  prosemirrorToDocumentBody,
} from './documentBody'
import { prepareBodyTransaction } from './prepareBodyTransaction'

function sampleBody(): DocumentBodyNode[] {
  const nodes: DocumentBodyNode[] = []
  const siblingOrders = new Map<string | null, number>()
  const add = (
    parentID: string | null,
    type: string,
    content = '',
    attributes: Record<string, unknown> = {}
  ) => {
    const siblingOrder = siblingOrders.get(parentID) ?? 0
    siblingOrders.set(parentID, siblingOrder + 1)
    const nodeID = `node-${nodes.length}`
    nodes.push({ nodeID, parentID, siblingOrder, type, content, attributes })
    return nodeID
  }

  const root = add(null, 'document')
  const paragraph = add(root, 'paragraph')
  add(paragraph, 'run', 'bold', {
    bold: true,
    boldMarker: '**',
    source: '**bold**',
  })
  add(paragraph, 'image', '', { src: 'https://example.com/a.png', alt: 'a' })
  add(paragraph, 'math', 'x + y', { marker: '$' })
  add(paragraph, 'line-break', '', { hard: true })
  add(paragraph, 'opaque-inline', '\\literal{raw}')
  add(paragraph, 'run', ' linked', {
    href: 'https://example.com',
    linkTitle: 'example',
  })
  add(root, 'paragraph', 'legacy parent text')

  const atxHeading = add(root, 'atx-heading', '', { level: 2 })
  add(atxHeading, 'run', 'Heading')
  const setextHeading = add(root, 'setext-heading', '', {
    level: 1,
    underline: '=',
  })
  add(setextHeading, 'run', 'Setext')
  add(root, 'thematic-break', '---')
  add(root, 'code-block', 'const value = 1', {
    type: 'fenced',
    lang: 'ts',
    fenceLength: 3,
  })
  add(root, 'html-block', '<!-- exact source -->')
  add(root, 'link-reference-definition', '[ref]: https://example.com')

  const quote = add(root, 'block-quote')
  const quoteParagraph = add(quote, 'paragraph')
  add(quoteParagraph, 'run', 'quoted')
  const ordered = add(root, 'order-list', '', {
    start: 2,
    loose: false,
    delimiter: ')',
  })
  const orderedItem = add(ordered, 'list-item')
  const orderedParagraph = add(orderedItem, 'paragraph')
  add(orderedParagraph, 'run', 'ordered')
  const bullet = add(root, 'bullet-list', '', { marker: '*', loose: true })
  const bulletItem = add(bullet, 'list-item')
  const bulletParagraph = add(bulletItem, 'paragraph')
  add(bulletParagraph, 'run', 'bullet')
  const task = add(root, 'task-list', '', { marker: '-', loose: false })
  const taskItem = add(task, 'task-list-item', '', { checked: true })
  const taskParagraph = add(taskItem, 'paragraph')
  add(taskParagraph, 'run', 'task')

  const table = add(root, 'table')
  const row = add(table, 'table.row')
  const cell = add(row, 'table.cell', '', { align: 'center' })
  add(cell, 'run', 'cell')
  add(root, 'math-block', 'x = 1', { mathStyle: '' })
  add(root, 'frontmatter', 'title: doc', { lang: 'yaml', style: '-' })
  add(root, 'diagram', 'graph: {}', { type: 'mermaid', lang: 'yaml' })
  const footnote = add(root, 'footnote', '', { identifier: 'note-1' })
  const footnoteParagraph = add(footnote, 'paragraph')
  add(footnoteParagraph, 'run', 'note')
  add(root, 'opaque', '::: unsupported syntax\nexact bytes')

  return nodes
}

describe('DokuDocs Body ↔ ProseMirror codec', () => {
  it('updates the editable DOM state when switched to read-only', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const ydoc = prosemirrorToYDoc(
      documentBodyToProseMirror(sampleBody()),
      'body'
    )
    const editor = createDocumentBodyEditor(host, ydoc)

    try {
      expect(editor.view.dom.getAttribute('contenteditable')).toBe('true')
      editor.setReadOnly(true)
      expect(editor.view.dom.getAttribute('contenteditable')).toBe('false')
    } finally {
      editor.destroy()
      ydoc.destroy()
      host.remove()
    }
  })

  it('preserves root source formatting metadata through Yjs', () => {
    const body = sampleBody()
    body[0]!.attributes = {
      trailingWhitespace: '\r\n  ',
      sourceGaps: {
        '00000000-0000-4000-8000-000000000099': '\n\n\n',
      },
      sourceTables: {
        '00000000-0000-4000-8000-000000000098': '|a|b|\n|---|---|\n|x|y|',
      },
    }
    const ydoc = prosemirrorToYDoc(documentBodyToProseMirror(body), 'body')

    try {
      const restored = documentBodySchema.nodeFromJSON(
        yDocToProsemirrorJSON(ydoc, 'body')
      )
      expect(prosemirrorToDocumentBody(restored)).toEqual(body)
    } finally {
      ydoc.destroy()
    }
  })

  it('preserves every node type, ID, attribute, order, and source through Yjs', () => {
    const body = sampleBody()
    const editorDocument = documentBodyToProseMirror(body)
    const ydoc = prosemirrorToYDoc(editorDocument, 'body')

    try {
      const restoredJSON = yDocToProsemirrorJSON(ydoc, 'body')
      const restoredEditorDocument =
        documentBodySchema.nodeFromJSON(restoredJSON)
      expect(prosemirrorToDocumentBody(restoredEditorDocument)).toEqual(body)
    } finally {
      ydoc.destroy()
    }
  })

  it('converges concurrent edits through the full Body schema', () => {
    const seed = prosemirrorToYDoc(
      documentBodyToProseMirror(sampleBody()),
      'body'
    )
    const initialUpdate = Y.encodeStateAsUpdate(seed)
    const firstDoc = new Y.Doc()
    const secondDoc = new Y.Doc()
    Y.applyUpdate(firstDoc, initialUpdate)
    Y.applyUpdate(secondDoc, initialUpdate)
    const firstBase = Y.encodeStateVector(firstDoc)
    const secondBase = Y.encodeStateVector(secondDoc)
    const firstHost = document.createElement('div')
    const secondHost = document.createElement('div')
    document.body.append(firstHost, secondHost)
    let firstView: EditorView | undefined
    let secondView: EditorView | undefined

    try {
      const firstFragment = firstDoc.getXmlFragment('body')
      const secondFragment = secondDoc.getXmlFragment('body')
      firstView = new EditorView(firstHost, {
        state: EditorState.create({
          doc: yXmlFragmentToProseMirrorRootNode(
            firstFragment,
            documentBodySchema
          ),
          plugins: [ySyncPlugin(firstFragment)],
        }),
      })
      secondView = new EditorView(secondHost, {
        state: EditorState.create({
          doc: yXmlFragmentToProseMirrorRootNode(
            secondFragment,
            documentBodySchema
          ),
          plugins: [ySyncPlugin(secondFragment)],
        }),
      })

      const firstPosition = endOfRun(firstView.state.doc, 'bold')
      const secondPosition = endOfRun(secondView.state.doc, 'bold')
      firstView.dispatch(firstView.state.tr.insertText(' A', firstPosition))
      secondView.dispatch(secondView.state.tr.insertText(' B', secondPosition))

      const firstUpdate = Y.encodeStateAsUpdate(firstDoc, firstBase)
      const secondUpdate = Y.encodeStateAsUpdate(secondDoc, secondBase)
      Y.applyUpdate(firstDoc, secondUpdate)
      Y.applyUpdate(secondDoc, firstUpdate)

      expect(firstView.state.doc.toJSON()).toEqual(
        secondView.state.doc.toJSON()
      )
      expect(prosemirrorToDocumentBody(firstView.state.doc)).toEqual(
        prosemirrorToDocumentBody(secondView.state.doc)
      )
    } finally {
      firstView?.destroy()
      secondView?.destroy()
      firstHost.remove()
      secondHost.remove()
      seed.destroy()
      firstDoc.destroy()
      secondDoc.destroy()
    }
  })

  it('rejects an inline parent with both raw text and child nodes', () => {
    expect(() =>
      documentBodyToProseMirror([
        {
          nodeID: 'root',
          parentID: null,
          siblingOrder: 0,
          type: 'document',
          content: '',
          attributes: {},
        },
        {
          nodeID: 'paragraph',
          parentID: 'root',
          siblingOrder: 0,
          type: 'paragraph',
          content: 'ambiguous',
          attributes: {},
        },
        {
          nodeID: 'run',
          parentID: 'paragraph',
          siblingOrder: 0,
          type: 'run',
          content: 'also child text',
          attributes: {},
        },
      ])
    ).toThrow('has both text content and child nodes')
  })

  it('splits a partially formatted run with a replicated ID for each segment', () => {
    const body: DocumentBodyNode[] = [
      {
        nodeID: 'root',
        parentID: null,
        siblingOrder: 0,
        type: 'document',
        content: '',
        attributes: {},
      },
      {
        nodeID: 'paragraph',
        parentID: 'root',
        siblingOrder: 0,
        type: 'paragraph',
        content: '',
        attributes: {},
      },
      {
        nodeID: 'run-original',
        parentID: 'paragraph',
        siblingOrder: 0,
        type: 'run',
        content: 'plain text',
        attributes: {},
      },
    ]
    const state = EditorState.create({
      doc: documentBodyToProseMirror(body),
    })
    let runPosition = -1
    state.doc.descendants((node, position) => {
      if (node.type.name === 'run') {
        runPosition = position
        return false
      }
      return true
    })
    const markStart = runPosition + 1 + 'plain '.length
    const transaction = state.tr.addMark(
      markStart,
      markStart + 'text'.length,
      documentBodySchema.marks.strong!.create()
    )

    const prepared = prepareBodyTransaction(state, transaction)
    const runs = prosemirrorToDocumentBody(prepared.doc).filter(
      (node) => node.type === 'run'
    )

    expect(runs.map((run) => run.content)).toEqual(['plain ', 'text'])
    expect(runs[0]!.nodeID).toBe('run-original')
    expect(runs[1]!.nodeID).not.toBe('run-original')
    expect(runs[1]!.attributes.bold).toBe(true)
  })

  it('replicates run-split IDs in the same Yjs transaction', () => {
    const body: DocumentBodyNode[] = [
      {
        nodeID: 'root',
        parentID: null,
        siblingOrder: 0,
        type: 'document',
        content: '',
        attributes: {},
      },
      {
        nodeID: 'paragraph',
        parentID: 'root',
        siblingOrder: 0,
        type: 'paragraph',
        content: '',
        attributes: {},
      },
      {
        nodeID: 'run-original',
        parentID: 'paragraph',
        siblingOrder: 0,
        type: 'run',
        content: 'plain text',
        attributes: {},
      },
    ]
    const host = document.createElement('div')
    document.body.append(host)
    const authorDoc = prosemirrorToYDoc(documentBodyToProseMirror(body), 'body')
    const editor = createDocumentBodyEditor(host, authorDoc)
    const peerDoc = new Y.Doc()
    Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(authorDoc))
    const baseStateVector = Y.encodeStateVector(authorDoc)

    try {
      let runPosition = -1
      editor.view.state.doc.descendants((node, position) => {
        if (node.type.name === 'run') {
          runPosition = position
          return false
        }
        return true
      })
      const markStart = runPosition + 1 + 'plain '.length
      const transaction = editor.view.state.tr.addMark(
        markStart,
        markStart + 'text'.length,
        documentBodySchema.marks.strong!.create()
      )
      editor.view.dispatch(transaction)

      Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(authorDoc, baseStateVector))
      const peerDocument = yXmlFragmentToProseMirrorRootNode(
        peerDoc.getXmlFragment('body'),
        documentBodySchema
      )
      const runs = prosemirrorToDocumentBody(peerDocument).filter(
        (node) => node.type === 'run'
      )

      expect(runs.map((run) => run.content)).toEqual(['plain ', 'text'])
      expect(runs[0]!.nodeID).toBe('run-original')
      expect(runs[1]!.nodeID).not.toBe('run-original')
      expect(runs[1]!.attributes.bold).toBe(true)
    } finally {
      editor.destroy()
      authorDoc.destroy()
      peerDoc.destroy()
      host.remove()
    }
  })

  it('prepares local edits in EditorView dispatch before Yjs sync', () => {
    const body: DocumentBodyNode[] = [
      {
        nodeID: 'root',
        parentID: null,
        siblingOrder: 0,
        type: 'document',
        content: '',
        attributes: {},
      },
      {
        nodeID: 'paragraph',
        parentID: 'root',
        siblingOrder: 0,
        type: 'paragraph',
        content: '',
        attributes: {},
      },
      {
        nodeID: 'run-original',
        parentID: 'paragraph',
        siblingOrder: 0,
        type: 'run',
        content: 'plain text',
        attributes: {},
      },
      {
        nodeID: 'opaque',
        parentID: 'root',
        siblingOrder: 1,
        type: 'opaque',
        content: 'raw source',
        attributes: {},
      },
    ]
    const host = document.createElement('div')
    document.body.append(host)
    const errors: unknown[] = []
    const authorDoc = prosemirrorToYDoc(documentBodyToProseMirror(body), 'body')
    const editor = createDocumentBodyEditor(host, authorDoc, {
      onTransactionError: (error) => errors.push(error),
    })
    const baseStateVector = Y.encodeStateVector(editor.ydoc)
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(editor.ydoc))

    try {
      let runPosition = -1
      editor.view.state.doc.descendants((node, position) => {
        if (node.type.name === 'run') {
          runPosition = position
          return false
        }
        return true
      })
      const markStart = runPosition + 1 + 'plain '.length
      editor.view.dispatch(
        editor.view.state.tr.addMark(
          markStart,
          markStart + 'text'.length,
          documentBodySchema.marks.strong!.create()
        )
      )

      const localRuns = editor.getBody().filter((node) => node.type === 'run')
      expect(localRuns.map((run) => run.content)).toEqual(['plain ', 'text'])
      expect(localRuns[0]!.nodeID).toBe('run-original')
      expect(localRuns[1]!.nodeID).not.toBe('run-original')
      expect(localRuns[1]!.attributes.bold).toBe(true)
      expect(errors).toEqual([])

      let opaquePosition = -1
      editor.view.state.doc.descendants((node, position) => {
        if (node.type.name === 'opaque') {
          opaquePosition = position
          return false
        }
        return true
      })
      const opaque = editor.view.state.doc.nodeAt(opaquePosition)!
      editor.view.dispatch(
        editor.view.state.tr.delete(
          opaquePosition,
          opaquePosition + opaque.nodeSize
        )
      )
      // Unsupported syntax is an ordinary block: it can be deleted.
      expect(errors).toEqual([])
      expect(editor.getBody().some((node) => node.type === 'opaque')).toBe(
        false
      )

      Y.applyUpdate(peer, Y.encodeStateAsUpdate(editor.ydoc, baseStateVector))
      const peerBody = prosemirrorToDocumentBody(
        yXmlFragmentToProseMirrorRootNode(
          peer.getXmlFragment('body'),
          documentBodySchema
        )
      )
      expect(peerBody).toEqual(editor.getBody())
      expect(peerBody.some((node) => node.type === 'opaque')).toBe(false)
    } finally {
      editor.destroy()
      authorDoc.destroy()
      peer.destroy()
      host.remove()
    }
  })

  it('ignores structural shortcuts while an IME composition is active', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const body = sampleBody()
    const ydoc = prosemirrorToYDoc(documentBodyToProseMirror(body), 'body')
    const editor = createDocumentBodyEditor(host, ydoc)
    try {
      const before = editor.view.state.doc.toJSON()
      const press = (init: KeyboardEventInit) =>
        editor.view.someProp('handleKeyDown', (handler) =>
          handler(editor.view, new KeyboardEvent('keydown', init))
        )
      const handled = press({
        key: 'ArrowDown',
        altKey: true,
        isComposing: true,
        cancelable: true,
      })
      expect(handled).toBeFalsy()
      expect(editor.view.state.doc.toJSON()).toEqual(before)
    } finally {
      editor.destroy()
      ydoc.destroy()
      host.remove()
    }
  })

  it('keeps one-block comment anchors stable through remote edits and local undo', () => {
    const body: DocumentBodyNode[] = [
      {
        nodeID: 'root',
        parentID: null,
        siblingOrder: 0,
        type: 'document',
        content: '',
        attributes: {},
      },
      {
        nodeID: 'paragraph-one',
        parentID: 'root',
        siblingOrder: 0,
        type: 'paragraph',
        content: '',
        attributes: {},
      },
      {
        nodeID: 'run-one',
        parentID: 'paragraph-one',
        siblingOrder: 0,
        type: 'run',
        content: 'left target',
        attributes: {},
      },
      {
        nodeID: 'paragraph-two',
        parentID: 'root',
        siblingOrder: 1,
        type: 'paragraph',
        content: '',
        attributes: {},
      },
      {
        nodeID: 'run-two',
        parentID: 'paragraph-two',
        siblingOrder: 0,
        type: 'run',
        content: 'tail',
        attributes: {},
      },
    ]
    const authorDoc = prosemirrorToYDoc(documentBodyToProseMirror(body), 'body')
    const peerDoc = new Y.Doc()
    Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(authorDoc))
    const authorHost = document.createElement('div')
    const peerHost = document.createElement('div')
    document.body.append(authorHost, peerHost)
    const author = createDocumentBodyEditor(authorHost, authorDoc)
    const peer = createDocumentBodyEditor(peerHost, peerDoc)

    try {
      const authorRunPosition = runPosition(
        author.view.state.doc,
        'left target'
      )
      const start = authorRunPosition + 1 + 'left '.length
      const end = start + 'target'.length
      const anchor = author.createAnchor(start, end)
      const tailPosition = runPosition(author.view.state.doc, 'tail')
      expect(() => author.createAnchor(start, tailPosition + 2)).toThrow(
        'one block'
      )

      const peerBaseStateVector = Y.encodeStateVector(peerDoc)
      const peerRunPosition = runPosition(peer.view.state.doc, 'left target')
      peer.view.dispatch(
        peer.view.state.tr.insertText('remote ', peerRunPosition + 1)
      )
      Y.applyUpdate(
        authorDoc,
        Y.encodeStateAsUpdate(peerDoc, peerBaseStateVector)
      )

      const resolved = author.resolveAnchor(anchor)
      expect(resolved).not.toBeNull()
      expect(resolved!.from).toBe(start + 'remote '.length)
      expect(
        author.view.state.doc.textBetween(resolved!.from, resolved!.to)
      ).toBe('target')

      yUndoPluginKey.getState(author.view.state)?.undoManager.stopCapturing()
      const updatedRunPosition = runPosition(
        author.view.state.doc,
        'remote left target'
      )
      author.view.dispatch(
        author.view.state.tr.insertText(
          ' local',
          updatedRunPosition + 1 + 'remote left target'.length
        )
      )
      expect(author.undo()).toBe(true)
      expect(
        author
          .getBody()
          .filter((node) => node.type === 'run')
          .map((node) => node.content)
          .join('')
      ).toBe('remote left targettail')

      Y.applyUpdate(
        peerDoc,
        Y.encodeStateAsUpdate(authorDoc, peerBaseStateVector)
      )
      expect(peer.getBody()).toEqual(author.getBody())
    } finally {
      author.destroy()
      peer.destroy()
      authorDoc.destroy()
      peerDoc.destroy()
      authorHost.remove()
      peerHost.remove()
    }
  })

  it('turns formatted legacy parent text into ID-bearing runs', () => {
    const body: DocumentBodyNode[] = [
      {
        nodeID: 'root',
        parentID: null,
        siblingOrder: 0,
        type: 'document',
        content: '',
        attributes: {},
      },
      {
        nodeID: 'paragraph',
        parentID: 'root',
        siblingOrder: 0,
        type: 'paragraph',
        content: 'plain text',
        attributes: {},
      },
    ]
    const state = EditorState.create({
      doc: documentBodyToProseMirror(body),
    })
    const textStart = 2
    const transaction = state.tr.addMark(
      textStart + 'plain '.length,
      textStart + 'plain text'.length,
      documentBodySchema.marks.strong!.create()
    )

    const prepared = prepareBodyTransaction(state, transaction)
    const restored = prosemirrorToDocumentBody(prepared.doc)
    const paragraph = restored.find((node) => node.type === 'paragraph')!
    const runs = restored.filter((node) => node.type === 'run')

    expect(paragraph.content).toBe('')
    expect(runs.map((run) => run.content)).toEqual(['plain ', 'text'])
    expect(runs.every((run) => run.nodeID.length > 0)).toBe(true)
    expect(runs[1]!.attributes.bold).toBe(true)
  })

  it('adds an empty paragraph to an editable body that has no blocks', () => {
    const root: DocumentBodyNode = {
      nodeID: 'root',
      parentID: null,
      siblingOrder: 0,
      type: 'document',
      content: '',
      attributes: {},
    }
    const ydoc = prosemirrorToYDoc(documentBodyToProseMirror([root]), 'body')
    const mount = document.createElement('div')
    const editor = createDocumentBodyEditor(mount, ydoc)
    const readOnlyDoc = prosemirrorToYDoc(
      documentBodyToProseMirror([root]),
      'body'
    )
    const readOnly = createDocumentBodyEditor(
      document.createElement('div'),
      readOnlyDoc,
      { readOnly: true }
    )

    try {
      expect(editor.getBody().map((node) => node.type)).toEqual([
        'document',
        'paragraph',
      ])
      expect(readOnly.getBody().map((node) => node.type)).toEqual(['document'])
      readOnly.setReadOnly(false)
      expect(readOnly.getBody().map((node) => node.type)).toEqual([
        'document',
        'paragraph',
      ])
    } finally {
      editor.destroy()
      readOnly.destroy()
      ydoc.destroy()
      readOnlyDoc.destroy()
    }
  })

  it('reports the local selection as relative positions that resolve to the same text', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const ydoc = prosemirrorToYDoc(
      documentBodyToProseMirror(twoParagraphBody()),
      'body'
    )
    const selections: Array<{ anchor: Uint8Array; head: Uint8Array } | null> =
      []
    const editor = createDocumentBodyEditor(host, ydoc, {
      onSelectionChange: (selection) => selections.push(selection),
    })

    try {
      const start = runPosition(editor.view.state.doc, 'first') + 1
      editor.view.dispatch(
        editor.view.state.tr.setSelection(
          TextSelection.create(editor.view.state.doc, start + 1, start + 4)
        )
      )

      const reported = selections.at(-1)
      expect(reported).not.toBeNull()
      const resolved = editor.resolveSelection(reported!)
      expect(resolved).toEqual({ anchor: start + 1, head: start + 4 })
    } finally {
      editor.destroy()
      ydoc.destroy()
      host.remove()
    }
  })

  it('draws a remote selection with the collaborator name and color, and removes it', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const ydoc = prosemirrorToYDoc(
      documentBodyToProseMirror(twoParagraphBody()),
      'body'
    )
    const editor = createDocumentBodyEditor(host, ydoc)

    try {
      const start = runPosition(editor.view.state.doc, 'second') + 1
      const anchor = editor.createAnchor(start + 1, start + 4)
      const cursor = {
        connectionID: 'c1',
        userID: 'u2',
        name: 'Bo',
        color: '#0369A1',
        anchor: anchor.start,
        head: anchor.end,
      }
      editor.setRemoteCursors([cursor])

      const caret = host.querySelector('.remote-cursor')
      expect(caret?.getAttribute('data-name')).toBe('Bo')
      expect(caret?.textContent).toBe('')
      expect(
        (caret as HTMLElement).style.getPropertyValue('--cursor-color')
      ).toBe('#0369A1')
      expect(host.querySelector('.remote-selection')?.textContent).toBe('eco')

      // A color that is not a plain hex value is ignored, not injected.
      editor.setRemoteCursors([{ ...cursor, color: 'red; background: url(x)' }])
      const unsafe = host.querySelector('.remote-cursor') as HTMLElement
      expect(unsafe.style.getPropertyValue('--cursor-color')).not.toContain(
        'url'
      )

      editor.setRemoteCursors([])
      expect(host.querySelector('.remote-cursor')).toBeNull()
      expect(host.querySelector('.remote-selection')).toBeNull()
    } finally {
      editor.destroy()
      ydoc.destroy()
      host.remove()
    }
  })
})

function endOfRun(doc: EditorState['doc'], text: string) {
  let position: number | undefined
  doc.descendants((node, nodePosition) => {
    if (node.type.name === 'run' && node.textContent === text) {
      position = nodePosition + node.nodeSize - 1
      return false
    }
    return true
  })
  if (position === undefined) throw new Error(`missing run ${text}`)
  return position
}

function runPosition(doc: EditorState['doc'], text: string) {
  let position = -1
  doc.descendants((node, nodePosition) => {
    if (node.type.name === 'run' && node.textContent === text) {
      position = nodePosition
      return false
    }
    return true
  })
  if (position < 0) throw new Error(`missing run ${text}`)
  return position
}

function twoParagraphBody(): DocumentBodyNode[] {
  const node = (
    nodeID: string,
    parentID: string | null,
    siblingOrder: number,
    type: string,
    content = ''
  ): DocumentBodyNode => ({
    nodeID,
    parentID,
    siblingOrder,
    type,
    content,
    attributes: {},
  })
  return [
    node('root', null, 0, 'document'),
    node('p1', 'root', 0, 'paragraph'),
    node('r1', 'p1', 0, 'run', 'first'),
    node('p2', 'root', 1, 'paragraph'),
    node('r2', 'p2', 0, 'run', 'second'),
  ]
}
