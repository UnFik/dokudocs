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
import { ApiError } from '@/lib/api-client'
import { recoverPendingMarkdown } from '../collaboration-recovery'
import {
  IndexedDBCollaborationStore,
  type PendingMoveNodeCommand,
} from '../collaboration-store'
import { mountCollaborativeDocumentBody } from '../collaborative-document-body'
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

class FakeCollaborationSocket extends EventTarget {
  readyState = 0
  sent: string[] = []

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }

  open() {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }

  receive(message: unknown) {
    this.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify(message) })
    )
  }
}

function encodeBase64(bytes: Uint8Array) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary)
}

async function waitUntil(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timed out waiting for collaboration state')
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
      expect(errors.map(String).join('\n')).toContain(
        'cannot be changed or removed'
      )
      expect(editor.getBody().some((node) => node.type === 'opaque')).toBe(true)

      Y.applyUpdate(peer, Y.encodeStateAsUpdate(editor.ydoc, baseStateVector))
      const peerBody = prosemirrorToDocumentBody(
        yXmlFragmentToProseMirrorRootNode(
          peer.getXmlFragment('body'),
          documentBodySchema
        )
      )
      expect(peerBody).toEqual(editor.getBody())
      expect(peerBody.some((node) => node.type === 'opaque')).toBe(true)
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

  it('rejects deleting an opaque node before the Yjs binding receives the edit', () => {
    const state = EditorState.create({
      doc: documentBodyToProseMirror(sampleBody()),
    })
    let opaquePosition = -1
    let opaqueNodeSize = 0
    state.doc.descendants((node, position) => {
      if (node.type.name === 'opaque') {
        opaquePosition = position
        opaqueNodeSize = node.nodeSize
        return false
      }
      return true
    })
    if (opaquePosition < 0 || opaqueNodeSize === 0)
      throw new Error('missing opaque node')

    expect(() =>
      prepareBodyTransaction(
        state,
        state.tr.delete(opaquePosition, opaquePosition + opaqueNodeSize)
      )
    ).toThrow('cannot be changed or removed')
  })

  it('routes a pure block deletion through DeleteNode without changing local Yjs state', async () => {
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
        nodeID: 'block-to-delete',
        parentID: 'root',
        siblingOrder: 0,
        type: 'paragraph',
        content: 'remove this block',
        attributes: {},
      },
    ]
    const ydoc = prosemirrorToYDoc(documentBodyToProseMirror(body), 'body')
    const yStateBefore = Y.encodeStateAsUpdate(ydoc)
    const mount = document.createElement('div')
    const deleteRequests: string[] = []
    const editor = createDocumentBodyEditor(mount, ydoc, {
      onDeleteNode: async (nodeID) => {
        deleteRequests.push(nodeID)
      },
    })

    try {
      const block = editor.view.state.doc.child(0).child(0)
      editor.view.dispatch(editor.view.state.tr.delete(1, 1 + block.nodeSize))
      await waitUntil(async () => deleteRequests.length === 1)

      expect(deleteRequests).toEqual(['block-to-delete'])
      expect(editor.getBody()).toEqual(body)
      expect(Y.encodeStateAsUpdate(ydoc)).toEqual(yStateBefore)
    } finally {
      editor.destroy()
      ydoc.destroy()
    }
  })

  it('queues DeleteNode when Backspace is pressed on a fully selected paragraph', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const ydoc = prosemirrorToYDoc(
      documentBodyToProseMirror(twoParagraphBody()),
      'body'
    )
    const yStateBefore = Y.encodeStateAsUpdate(ydoc)
    const deleteRequests: string[] = []
    const editor = createDocumentBodyEditor(host, ydoc, {
      onDeleteNode: (nodeID) => {
        deleteRequests.push(nodeID)
      },
    })

    try {
      const start = runPosition(editor.view.state.doc, 'second')
      editor.view.dispatch(
        editor.view.state.tr.setSelection(
          TextSelection.create(editor.view.state.doc, start, start + 8)
        )
      )
      editor.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Backspace',
          bubbles: true,
          cancelable: true,
        })
      )
      await waitUntil(async () => deleteRequests.length === 1)

      expect(deleteRequests).toEqual(['p2'])
      expect(Y.encodeStateAsUpdate(ydoc)).toEqual(yStateBefore)
    } finally {
      editor.destroy()
      ydoc.destroy()
      host.remove()
    }
  })

  it('queues MoveNode when Alt+ArrowDown is pressed in a paragraph', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const ydoc = prosemirrorToYDoc(
      documentBodyToProseMirror(twoParagraphBody()),
      'body'
    )
    const yStateBefore = Y.encodeStateAsUpdate(ydoc)
    const moves: unknown[] = []
    const editor = createDocumentBodyEditor(host, ydoc, {
      onMoveNode: (move) => {
        moves.push(move)
      },
    })

    try {
      const start = runPosition(editor.view.state.doc, 'first')
      editor.view.dispatch(
        editor.view.state.tr.setSelection(
          TextSelection.create(editor.view.state.doc, start + 1)
        )
      )
      editor.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          altKey: true,
          bubbles: true,
          cancelable: true,
        })
      )
      await waitUntil(async () => moves.length === 1)

      expect(moves).toEqual([
        { nodeID: 'p1', targetParentID: 'root', beforeNodeID: null },
      ])
      expect(Y.encodeStateAsUpdate(ydoc)).toEqual(yStateBefore)
    } finally {
      editor.destroy()
      ydoc.destroy()
      host.remove()
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

  it('blocks deleting the last formatted character when it would remove the run', async () => {
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
        nodeID: 'formatted-run',
        parentID: 'paragraph',
        siblingOrder: 0,
        type: 'run',
        content: 'x',
        attributes: {
          bold: true,
          boldMarker: '**',
          href: 'https://example.com',
        },
      },
      {
        nodeID: 'plain-run',
        parentID: 'paragraph',
        siblingOrder: 1,
        type: 'run',
        content: ' remains',
        attributes: {},
      },
    ]
    const host = document.createElement('div')
    document.body.append(host)
    const ydoc = prosemirrorToYDoc(documentBodyToProseMirror(body), 'body')
    const yStateBefore = Y.encodeStateAsUpdate(ydoc)
    const deleteRequests: string[] = []
    const errors: unknown[] = []
    const editor = createDocumentBodyEditor(host, ydoc, {
      onDeleteNode: (nodeID) => {
        deleteRequests.push(nodeID)
      },
      onTransactionError: (error) => {
        errors.push(error)
      },
    })

    try {
      const position = runPosition(editor.view.state.doc, 'x')
      editor.view.dispatch(
        editor.view.state.tr.delete(position + 1, position + 2)
      )
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(deleteRequests).toEqual([])
      expect(errors).toEqual([])
      expect(editor.getBody()).toEqual(body)
      expect(editor.view.dom.textContent).toBe('x remains')
      expect(Y.encodeStateAsUpdate(ydoc)).toEqual(yStateBefore)
    } finally {
      editor.destroy()
      ydoc.destroy()
      host.remove()
    }
  })

  it('connects editor block deletion to the persisted DeleteNode command path', async () => {
    const rootNodeID = crypto.randomUUID()
    const nodeID = crypto.randomUUID()
    const initialBody: DocumentBodyNode[] = [
      {
        nodeID: rootNodeID,
        parentID: null,
        siblingOrder: 0,
        type: 'document',
        content: '',
        attributes: {},
      },
      {
        nodeID,
        parentID: rootNodeID,
        siblingOrder: 0,
        type: 'paragraph',
        content: 'remove me',
        attributes: {},
      },
    ]
    const source = prosemirrorToYDoc(
      documentBodyToProseMirror(initialBody),
      'body'
    )
    const state = Y.encodeStateAsUpdate(source)
    source.destroy()

    const canonicalRoot: DocumentBodyNode = {
      ...initialBody[0]!,
    }
    const canonicalDoc = prosemirrorToYDoc(
      documentBodyToProseMirror([canonicalRoot]),
      'body'
    )
    const canonicalState = Y.encodeStateAsUpdate(canonicalDoc)
    canonicalDoc.destroy()

    const socket = new FakeCollaborationSocket()
    const scope = {
      userID: crypto.randomUUID(),
      documentID: crypto.randomUUID(),
    }
    const store = new IndexedDBCollaborationStore()
    const host = document.createElement('div')
    document.body.append(host)
    const commands: { commandID: string; bodyEpoch: number; nodeID: string }[] =
      []
    let canonicalEpoch = 0
    let queuedNodeID = ''
    let signalReady!: () => void
    const ready = new Promise<void>((resolve) => {
      signalReady = resolve
    })
    const session = await mountCollaborativeDocumentBody(host, {
      documentID: scope.documentID,
      workspaceID: crypto.randomUUID(),
      userID: scope.userID,
      token: 'test-token',
      snapshot: {
        bodyVersion: 1,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: true,
        encodedState: encodeBase64(state),
      },
      store,
      socketFactory: () => socket,
      onStatus: (status) => {
        if (status === 'ready') signalReady()
      },
      executeDeleteNode: async (command) => {
        commands.push(command)
        return {
          bodyVersion: 2,
          bodyEpoch: 2,
          bodySchemaVersion: 1,
          canEdit: true,
          rootNodeID,
          nodes: [canonicalRoot].map((node) => ({ ...node, version: 1 })),
          encodedState: encodeBase64(canonicalState),
        }
      },
      onCanonicalBody: (body) => {
        canonicalEpoch = body.bodyEpoch
      },
      onDeleteNodeQueued: (value) => {
        queuedNodeID = value
      },
    })

    try {
      socket.open()
      socket.receive({
        type: 'ready',
        bodyVersion: 1,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: true,
        state: encodeBase64(state),
      })
      await ready

      const paragraph = session.editor.view.state.doc.child(0).child(0)
      session.editor.view.dispatch(
        session.editor.view.state.tr.delete(1, 1 + paragraph.nodeSize)
      )
      await waitUntil(async () => {
        const stored = await store.load(scope)
        return (
          stored.deleteCommands.length === 0 &&
          canonicalEpoch === 2 &&
          queuedNodeID === nodeID
        )
      })

      expect(commands).toHaveLength(1)
      expect(commands[0]).toMatchObject({
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        nodeID,
      })
      expect(session.editor.getBody()).toEqual(initialBody)
      expect(
        socket.sent.map((frame) => (JSON.parse(frame) as { type: string }).type)
      ).toEqual(['auth'])
      expect((await store.load(scope)).snapshot?.bodyEpoch).toBe(2)
    } finally {
      session.destroy()
      host.remove()
      await store.clear(scope)
    }
  })

  it('connects editor block movement to the persisted MoveNode command path', async () => {
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
        nodeID: 'first',
        parentID: 'root',
        siblingOrder: 0,
        type: 'paragraph',
        content: 'first',
        attributes: {},
      },
      {
        nodeID: 'second',
        parentID: 'root',
        siblingOrder: 1,
        type: 'paragraph',
        content: 'second',
        attributes: {},
      },
    ]
    const movedBody = [
      body[0]!,
      { ...body[2]!, siblingOrder: 0 },
      { ...body[1]!, siblingOrder: 1 },
    ]
    const source = prosemirrorToYDoc(documentBodyToProseMirror(body), 'body')
    const state = Y.encodeStateAsUpdate(source)
    source.destroy()
    const canonicalDoc = prosemirrorToYDoc(
      documentBodyToProseMirror(movedBody),
      'body'
    )
    const canonicalState = Y.encodeStateAsUpdate(canonicalDoc)
    canonicalDoc.destroy()

    const socket = new FakeCollaborationSocket()
    const scope = {
      userID: crypto.randomUUID(),
      documentID: crypto.randomUUID(),
    }
    const store = new IndexedDBCollaborationStore()
    const host = document.createElement('div')
    document.body.append(host)
    const commands: PendingMoveNodeCommand[] = []
    let canonicalEpoch = 0
    let queuedNodeID = ''
    let signalReady!: () => void
    const ready = new Promise<void>((resolve) => {
      signalReady = resolve
    })
    const session = await mountCollaborativeDocumentBody(host, {
      documentID: scope.documentID,
      workspaceID: crypto.randomUUID(),
      userID: scope.userID,
      token: 'test-token',
      snapshot: {
        bodyVersion: 1,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: true,
        encodedState: encodeBase64(state),
      },
      store,
      socketFactory: () => socket,
      onStatus: (status) => {
        if (status === 'ready') signalReady()
      },
      executeMoveNode: async (command) => {
        commands.push(command)
        return {
          bodyVersion: 2,
          bodyEpoch: 2,
          bodySchemaVersion: 1,
          canEdit: true,
          rootNodeID: 'root',
          nodes: movedBody.map((node) => ({ ...node, version: 1 })),
          encodedState: encodeBase64(canonicalState),
        }
      },
      onCanonicalBody: (canonical) => {
        canonicalEpoch = canonical.bodyEpoch
      },
      onMoveNodeQueued: (move) => {
        queuedNodeID = move.nodeID
      },
    })

    try {
      socket.open()
      socket.receive({
        type: 'ready',
        bodyVersion: 1,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: true,
        state: encodeBase64(state),
      })
      await ready

      const first = session.editor.view.state.doc.child(0).child(0)
      const transaction = session.editor.view.state.tr
        .delete(1, 1 + first.nodeSize)
        .insert(
          session.editor.view.state.doc.content.size - 1 - first.nodeSize,
          first
        )
      session.editor.view.dispatch(transaction)
      await waitUntil(async () => {
        const stored = await store.load(scope)
        return (
          stored.moveCommands.length === 0 &&
          canonicalEpoch === 2 &&
          queuedNodeID === 'first'
        )
      })

      expect(commands).toHaveLength(1)
      expect(commands[0]).toMatchObject({
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        nodeID: 'first',
        targetParentID: 'root',
        beforeNodeID: null,
      })
      expect(session.editor.getBody()).toEqual(body)
      expect(
        socket.sent.map((frame) => (JSON.parse(frame) as { type: string }).type)
      ).toEqual(['auth'])
      expect((await store.load(scope)).snapshot?.bodyEpoch).toBe(2)
    } finally {
      session.destroy()
      host.remove()
      await store.clear(scope)
    }
  })

  it('rejects moving an ancestor that contains an opaque node', () => {
    const state = EditorState.create({
      doc: documentBodyToProseMirror(sampleBody()),
    })
    const documentNode = state.doc.child(0)
    const paragraphWithOpaque = documentNode.child(0)
    const transaction = state.tr
      .delete(1, 1 + paragraphWithOpaque.nodeSize)
      .insert(
        state.tr.doc.content.size - 1 - paragraphWithOpaque.nodeSize,
        paragraphWithOpaque
      )

    expect(() => prepareBodyTransaction(state, transaction)).toThrow(
      'cannot be reordered'
    )
  })

  it('requires an authorized MoveNode ID for reordering existing blocks', () => {
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
        nodeID: 'first',
        parentID: 'root',
        siblingOrder: 0,
        type: 'paragraph',
        content: 'first',
        attributes: {},
      },
      {
        nodeID: 'second',
        parentID: 'root',
        siblingOrder: 1,
        type: 'paragraph',
        content: 'second',
        attributes: {},
      },
    ]
    const state = EditorState.create({
      doc: documentBodyToProseMirror(body),
    })
    const documentNode = state.doc.child(0)
    const firstNode = documentNode.child(0)
    const transaction = state.tr
      .delete(1, 1 + firstNode.nodeSize)
      .insert(state.doc.content.size - 1 - firstNode.nodeSize, firstNode)

    let moveError: unknown
    try {
      prepareBodyTransaction(state, transaction)
    } catch (error) {
      moveError = error
    }
    expect(moveError).toMatchObject({
      name: 'MoveNodeRequiredError',
      nodeID: 'first',
      targetParentID: 'root',
      beforeNodeID: null,
    })
    expect(() =>
      prepareBodyTransaction(state, transaction, {
        authorizedMoveNodeIDs: new Set(['first']),
      })
    ).not.toThrow()
  })

  it('routes a pure block move through MoveNode without changing local Yjs state', async () => {
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
        nodeID: 'first',
        parentID: 'root',
        siblingOrder: 0,
        type: 'paragraph',
        content: 'first',
        attributes: {},
      },
      {
        nodeID: 'second',
        parentID: 'root',
        siblingOrder: 1,
        type: 'paragraph',
        content: 'second',
        attributes: {},
      },
    ]
    const ydoc = prosemirrorToYDoc(documentBodyToProseMirror(body), 'body')
    const yStateBefore = Y.encodeStateAsUpdate(ydoc)
    const mount = document.createElement('div')
    const moves: {
      nodeID: string
      targetParentID: string
      beforeNodeID: string | null
    }[] = []
    const editor = createDocumentBodyEditor(mount, ydoc, {
      onMoveNode: async (move) => {
        moves.push(move)
      },
    })

    try {
      const state = editor.view.state
      const node = state.doc.child(0).child(0)
      const transaction = state.tr
        .delete(1, 1 + node.nodeSize)
        .insert(state.doc.content.size - 1 - node.nodeSize, node)
      editor.view.dispatch(transaction)
      await waitUntil(async () => moves.length === 1)

      expect(moves).toEqual([
        { nodeID: 'first', targetParentID: 'root', beforeNodeID: null },
      ])
      expect(editor.getBody()).toEqual(body)
      expect(Y.encodeStateAsUpdate(ydoc)).toEqual(yStateBefore)
    } finally {
      editor.destroy()
      ydoc.destroy()
    }
  })

  it('classifies a cross-parent subtree move into its exact sibling slot', () => {
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
        nodeID: 'moving',
        parentID: 'root',
        siblingOrder: 0,
        type: 'paragraph',
        content: 'move me',
        attributes: {},
      },
      {
        nodeID: 'quote',
        parentID: 'root',
        siblingOrder: 1,
        type: 'block-quote',
        content: '',
        attributes: {},
      },
      {
        nodeID: 'inside',
        parentID: 'quote',
        siblingOrder: 0,
        type: 'paragraph',
        content: 'inside',
        attributes: {},
      },
    ]
    const state = EditorState.create({
      doc: documentBodyToProseMirror(body),
    })
    const moving = state.doc.child(0).child(0)
    const transaction = state.tr.delete(1, 1 + moving.nodeSize)
    let quotePosition = -1
    transaction.doc.descendants((node, position) => {
      if (node.attrs.nodeID === 'quote') quotePosition = position
      return true
    })
    transaction.insert(quotePosition + 1, moving)

    let moveError: unknown
    try {
      prepareBodyTransaction(state, transaction)
    } catch (error) {
      moveError = error
    }
    expect(moveError).toMatchObject({
      name: 'MoveNodeRequiredError',
      nodeID: 'moving',
      targetParentID: 'quote',
      beforeNodeID: 'inside',
    })
  })

  it('reidentifies inline children when their deleted parent is merged', () => {
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
        content: 'one',
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
        content: 'two',
        attributes: {},
      },
    ]
    const state = EditorState.create({
      doc: documentBodyToProseMirror(body),
    })
    const paragraph = state.doc.child(0).child(0)
    const transaction = state.tr.join(1 + paragraph.nodeSize)

    const prepared = prepareBodyTransaction(state, transaction)
    const restored = prosemirrorToDocumentBody(prepared.doc)
    const paragraphs = restored.filter((node) => node.type === 'paragraph')
    const runs = restored.filter((node) => node.type === 'run')

    expect(paragraphs).toHaveLength(1)
    expect(runs.map((run) => run.content)).toEqual(['one', 'two'])
    expect(runs[0]!.nodeID).toBe('run-one')
    expect(runs[1]!.nodeID).not.toBe('run-two')
  })

  it('connects the ProseMirror body editor to WebSocket and native IndexedDB', async () => {
    const source = prosemirrorToYDoc(
      documentBodyToProseMirror(sampleBody()),
      'body'
    )
    const state = Y.encodeStateAsUpdate(source)
    source.destroy()

    const socket = new FakeCollaborationSocket()
    const userID = crypto.randomUUID()
    const documentID = crypto.randomUUID()
    const workspaceID = crypto.randomUUID()
    const scope = { userID, documentID }
    const store = new IndexedDBCollaborationStore()
    const host = document.createElement('div')
    document.body.append(host)
    let signalReady!: () => void
    const ready = new Promise<void>((resolve) => {
      signalReady = resolve
    })
    let signalForbidden!: () => void
    const forbidden = new Promise<void>((resolve) => {
      signalForbidden = resolve
    })
    const session = await mountCollaborativeDocumentBody(host, {
      documentID,
      workspaceID,
      userID,
      token: 'test-token',
      snapshot: {
        bodyVersion: 1,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: true,
        encodedState: encodeBase64(state),
      },
      store,
      socketFactory: () => socket,
      onStatus: (status) => {
        if (status === 'ready') signalReady()
        if (status === 'forbidden') signalForbidden()
      },
    })

    try {
      socket.open()
      socket.receive({
        type: 'ready',
        bodyVersion: 1,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: true,
        state: encodeBase64(state),
      })
      await ready

      const end = endOfRun(session.editor.view.state.doc, 'bold')
      session.editor.view.dispatch(
        session.editor.view.state.tr.insertText('!', end)
      )
      await waitUntil(async () => {
        const stored = await store.load(scope)
        return (
          stored.updates.length === 1 &&
          socket.sent.some(
            (frame) => (JSON.parse(frame) as { type: string }).type === 'update'
          )
        )
      })

      const updateFrame = socket.sent
        .map(
          (frame) => JSON.parse(frame) as { type: string; updateID?: string }
        )
        .find((frame) => frame.type === 'update')
      expect(updateFrame?.updateID).toBeTruthy()
      expect((await store.load(scope)).updates).toHaveLength(1)

      socket.receive({
        type: 'ack',
        updateID: updateFrame!.updateID,
        bodyVersion: 2,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
      })
      await waitUntil(async () => {
        const stored = await store.load(scope)
        return stored.updates.length === 0 && stored.snapshot?.bodyVersion === 2
      })
      expect((await store.load(scope)).updates).toHaveLength(0)
      expect((await store.load(scope)).snapshot?.bodyVersion).toBe(2)
      expect(
        session.editor.getBody().some((node) => node.content === 'bold!')
      ).toBe(true)

      socket.receive({
        type: 'resync',
        bodyVersion: 2,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: false,
        state: encodeBase64(state),
      })
      await waitUntil(
        async () =>
          session.editor.view.dom.getAttribute('contenteditable') === 'false'
      )
      const lockedBody = session.editor.getBody()
      const lockedRunEnd = endOfRun(session.editor.view.state.doc, 'bold!')
      session.editor.view.dispatch(
        session.editor.view.state.tr.insertText('blocked', lockedRunEnd)
      )
      expect(session.editor.getBody()).toEqual(lockedBody)

      socket.receive({ type: 'error', code: 'forbidden' })
      await forbidden
      await waitUntil(async () => (await store.load(scope)).snapshot === null)
      expect(host.childNodes).toHaveLength(0)
    } finally {
      session.destroy()
      host.remove()
      await store.clear(scope)
    }
  })

  it('shares the local selection and shows remote cursors through the collaboration socket', async () => {
    const source = prosemirrorToYDoc(
      documentBodyToProseMirror(twoParagraphBody()),
      'body'
    )
    const state = Y.encodeStateAsUpdate(source)
    source.destroy()
    const socket = new FakeCollaborationSocket()
    const userID = crypto.randomUUID()
    const documentID = crypto.randomUUID()
    const host = document.createElement('div')
    document.body.append(host)
    let signalReady!: () => void
    const ready = new Promise<void>((resolve) => {
      signalReady = resolve
    })
    const session = await mountCollaborativeDocumentBody(host, {
      documentID,
      workspaceID: crypto.randomUUID(),
      userID,
      token: 'test-token',
      snapshot: {
        bodyVersion: 1,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: true,
        encodedState: encodeBase64(state),
      },
      store: new IndexedDBCollaborationStore(),
      socketFactory: () => socket,
      onStatus: (status) => {
        if (status === 'ready') signalReady()
      },
    })

    try {
      socket.open()
      socket.receive({
        type: 'ready',
        bodyVersion: 1,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: true,
        state: encodeBase64(state),
      })
      await ready

      const start = runPosition(session.editor.view.state.doc, 'first') + 1
      session.editor.view.dispatch(
        session.editor.view.state.tr.setSelection(
          TextSelection.create(session.editor.view.state.doc, start, start + 3)
        )
      )
      const cursorFrames = () =>
        socket.sent
          .map((frame) => JSON.parse(frame) as { type: string })
          .filter((frame) => frame.type === 'cursor')
      expect(cursorFrames()).toHaveLength(1)

      const anchor = session.editor.createAnchor(start, start + 3)
      socket.receive({
        type: 'cursor',
        cursor: {
          connectionID: 'c1',
          userID: 'u2',
          name: 'Bo',
          color: '#0369A1',
          anchor: encodeBase64(anchor.start),
          head: encodeBase64(anchor.end),
        },
      })
      await waitUntil(async () => host.querySelector('.remote-cursor') !== null)
      expect(host.querySelector('.remote-selection')?.textContent).toBe('fir')

      socket.close()
      await waitUntil(async () => host.querySelector('.remote-cursor') === null)
    } finally {
      session.destroy()
      host.remove()
    }
  })

  it('persists DeleteNode intent with its source epoch until canonical completion', async () => {
    const store = new IndexedDBCollaborationStore()
    const scope = {
      userID: crypto.randomUUID(),
      documentID: crypto.randomUUID(),
    }
    const snapshot = {
      bodyVersion: 3,
      bodyEpoch: 4,
      bodySchemaVersion: 1,
      canEdit: true,
      encodedState: new Uint8Array([1, 2, 3]),
    }
    const command = {
      commandID: crypto.randomUUID(),
      bodyEpoch: 4,
      bodySchemaVersion: 1,
      nodeID: crypto.randomUUID(),
    }

    await store.saveDeleteCommand(scope, snapshot, command)
    expect(await store.load(scope)).toEqual({
      snapshot,
      updates: [],
      deleteCommands: [command],
      moveCommands: [],
      heldEdits: [],
    })

    const canonical = { ...snapshot, bodyVersion: 4, bodyEpoch: 5 }
    await store.completeDeleteCommand(scope, command.commandID, canonical)
    expect(await store.load(scope)).toEqual({
      snapshot: canonical,
      updates: [],
      deleteCommands: [],
      moveCommands: [],
      heldEdits: [],
    })
    await store.clear(scope)
  })

  it('shows canonical body read-only while an old-epoch DeleteNode awaits review after reload', async () => {
    const store = new IndexedDBCollaborationStore()
    const scope = {
      userID: crypto.randomUUID(),
      documentID: crypto.randomUUID(),
    }
    const rootNodeID = crypto.randomUUID()
    const oldNodeID = crypto.randomUUID()
    const oldBody: DocumentBodyNode[] = [
      {
        nodeID: rootNodeID,
        parentID: null,
        siblingOrder: 0,
        type: 'document',
        content: '',
        attributes: {},
      },
      {
        nodeID: oldNodeID,
        parentID: rootNodeID,
        siblingOrder: 0,
        type: 'paragraph',
        content: 'stale local body',
        attributes: {},
      },
    ]
    const oldDoc = prosemirrorToYDoc(documentBodyToProseMirror(oldBody), 'body')
    const oldState = Y.encodeStateAsUpdate(oldDoc)
    oldDoc.destroy()
    await store.saveSnapshot(scope, {
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      canEdit: true,
      encodedState: oldState,
    })
    await store.saveDeleteCommand(
      scope,
      {
        bodyVersion: 1,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: true,
        encodedState: oldState,
      },
      {
        commandID: crypto.randomUUID(),
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        nodeID: oldNodeID,
      }
    )

    const canonicalBody = [oldBody[0]!]
    const canonicalDoc = prosemirrorToYDoc(
      documentBodyToProseMirror(canonicalBody),
      'body'
    )
    const canonicalState = Y.encodeStateAsUpdate(canonicalDoc)
    canonicalDoc.destroy()
    const host = document.createElement('div')
    document.body.append(host)
    let recoveryCount = 0
    const session = await mountCollaborativeDocumentBody(host, {
      documentID: scope.documentID,
      workspaceID: crypto.randomUUID(),
      userID: scope.userID,
      token: 'test-token',
      snapshot: {
        bodyVersion: 2,
        bodyEpoch: 2,
        bodySchemaVersion: 1,
        canEdit: true,
        encodedState: encodeBase64(canonicalState),
      },
      store,
      executeDeleteNode: async () => {
        throw new ApiError(409, 'stale_epoch')
      },
      onRecovery: (_reason, _updates, commands) => {
        recoveryCount = commands.length
      },
    })

    try {
      expect(session.editor.getBody()).toEqual(canonicalBody)
      expect(session.editor.view.dom.getAttribute('contenteditable')).toBe(
        'false'
      )
      expect(recoveryCount).toBe(1)
      expect((await store.load(scope)).deleteCommands).toHaveLength(1)
    } finally {
      session.destroy()
      host.remove()
      await store.clear(scope)
    }
  })

  it('keeps the canonical editor read-only while replaying a committed MoveNode receipt on reload', async () => {
    const store = new IndexedDBCollaborationStore()
    const scope = {
      userID: crypto.randomUUID(),
      documentID: crypto.randomUUID(),
    }
    const rootNodeID = crypto.randomUUID()
    const firstNodeID = crypto.randomUUID()
    const secondNodeID = crypto.randomUUID()
    const oldBody: DocumentBodyNode[] = [
      {
        nodeID: rootNodeID,
        parentID: null,
        siblingOrder: 0,
        type: 'document',
        content: '',
        attributes: {},
      },
      {
        nodeID: firstNodeID,
        parentID: rootNodeID,
        siblingOrder: 0,
        type: 'paragraph',
        content: 'first',
        attributes: {},
      },
      {
        nodeID: secondNodeID,
        parentID: rootNodeID,
        siblingOrder: 1,
        type: 'paragraph',
        content: 'second',
        attributes: {},
      },
    ]
    const canonicalBody = [
      oldBody[0]!,
      { ...oldBody[2]!, siblingOrder: 0 },
      { ...oldBody[1]!, siblingOrder: 1 },
    ]
    const oldDoc = prosemirrorToYDoc(documentBodyToProseMirror(oldBody), 'body')
    const oldState = Y.encodeStateAsUpdate(oldDoc)
    oldDoc.destroy()
    const canonicalDoc = prosemirrorToYDoc(
      documentBodyToProseMirror(canonicalBody),
      'body'
    )
    const canonicalState = Y.encodeStateAsUpdate(canonicalDoc)
    canonicalDoc.destroy()
    await store.saveSnapshot(scope, {
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      canEdit: true,
      encodedState: oldState,
    })
    await store.saveMoveCommand(
      scope,
      {
        bodyVersion: 1,
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        canEdit: true,
        encodedState: oldState,
      },
      {
        commandID: crypto.randomUUID(),
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        nodeID: firstNodeID,
        targetParentID: rootNodeID,
        beforeNodeID: null,
      }
    )

    const host = document.createElement('div')
    document.body.append(host)
    const session = await mountCollaborativeDocumentBody(host, {
      documentID: scope.documentID,
      workspaceID: crypto.randomUUID(),
      userID: scope.userID,
      token: 'test-token',
      snapshot: {
        bodyVersion: 2,
        bodyEpoch: 2,
        bodySchemaVersion: 1,
        canEdit: true,
        encodedState: encodeBase64(canonicalState),
      },
      store,
      executeMoveNode: async () => ({
        bodyVersion: 2,
        bodyEpoch: 2,
        bodySchemaVersion: 1,
        canEdit: true,
        rootNodeID,
        nodes: canonicalBody.map((node) => ({ ...node, version: 1 })),
        encodedState: encodeBase64(canonicalState),
      }),
    })

    try {
      expect(session.editor.getBody()).toEqual(canonicalBody)
      expect(session.editor.view.dom.getAttribute('contenteditable')).toBe(
        'false'
      )
      expect((await store.load(scope)).moveCommands).toEqual([])
    } finally {
      session.destroy()
      host.remove()
      await store.clear(scope)
    }
  })

  it('includes queued DeleteNode intent in the recovery Markdown export', async () => {
    const store = new IndexedDBCollaborationStore()
    const scope = {
      userID: crypto.randomUUID(),
      documentID: crypto.randomUUID(),
    }
    const source = prosemirrorToYDoc(
      documentBodyToProseMirror(sampleBody()),
      'body'
    )
    const snapshot = {
      bodyVersion: 3,
      bodyEpoch: 4,
      bodySchemaVersion: 1,
      canEdit: true,
      encodedState: Y.encodeStateAsUpdate(source),
    }
    source.destroy()
    const deletedParagraphID = 'node-1'
    await store.saveSnapshot(scope, snapshot)
    await store.saveDeleteCommand(scope, snapshot, {
      commandID: crypto.randomUUID(),
      bodyEpoch: 4,
      bodySchemaVersion: 1,
      nodeID: deletedParagraphID,
    })

    const recovered = await recoverPendingMarkdown(scope)
    expect(recovered).not.toContain('bold')
    expect(recovered).toContain('Heading')
    await store.clear(scope)
  })

  it('persists MoveNode until canonical completion and applies it to recovery export', async () => {
    const store = new IndexedDBCollaborationStore()
    const scope = {
      userID: crypto.randomUUID(),
      documentID: crypto.randomUUID(),
    }
    const body = sampleBody()
    const source = prosemirrorToYDoc(documentBodyToProseMirror(body), 'body')
    const snapshot = {
      bodyVersion: 3,
      bodyEpoch: 4,
      bodySchemaVersion: 1,
      canEdit: true,
      encodedState: Y.encodeStateAsUpdate(source),
    }
    source.destroy()
    const paragraph = body.find(
      (node) => node.content === 'legacy parent text'
    )!
    const quote = body.find((node) => node.type === 'block-quote')!
    const quoteParagraph = body.find((node) => node.parentID === quote.nodeID)!
    const command = {
      commandID: crypto.randomUUID(),
      bodyEpoch: 4,
      bodySchemaVersion: 1,
      nodeID: paragraph.nodeID,
      targetParentID: quote.nodeID,
      beforeNodeID: quoteParagraph.nodeID,
    }

    await store.saveMoveCommand(scope, snapshot, command)
    expect((await store.load(scope)).moveCommands).toEqual([command])
    const recovered = await recoverPendingMarkdown(scope)
    expect(recovered).toContain('> legacy parent text')
    expect(recovered).not.toContain('\n\nlegacy parent text')

    const canonical = { ...snapshot, bodyVersion: 4, bodyEpoch: 5 }
    await store.completeMoveCommand(scope, command.commandID, canonical)
    expect((await store.load(scope)).moveCommands).toEqual([])
    expect((await store.load(scope)).snapshot).toEqual(canonical)
    await store.clear(scope)
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
