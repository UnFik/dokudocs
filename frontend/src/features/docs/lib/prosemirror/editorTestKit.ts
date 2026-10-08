import { prosemirrorToYDoc } from 'y-prosemirror'
import type * as Y from 'yjs'
import type { DocumentBodyNode } from '../documentBody'
import { createDocumentBodyEditor } from './createDocumentBodyEditor'
import { documentBodyToProseMirror } from './documentBody'

/** One document node containing one paragraph (with one run) per text. */
export function paragraphsBody(...texts: string[]): DocumentBodyNode[] {
  const nodes: DocumentBodyNode[] = [
    {
      nodeID: 'root',
      parentID: null,
      siblingOrder: 0,
      type: 'document',
      content: '',
      attributes: {},
    },
  ]
  texts.forEach((text, index) => {
    nodes.push({
      nodeID: `p${index}`,
      parentID: 'root',
      siblingOrder: index,
      type: 'paragraph',
      content: '',
      attributes: {},
    })
    nodes.push({
      nodeID: `r${index}`,
      parentID: `p${index}`,
      siblingOrder: 0,
      type: 'run',
      content: text,
      attributes: {},
    })
  })
  return nodes
}

export function mountTestEditor(
  body: DocumentBodyNode[],
  options: Parameters<typeof createDocumentBodyEditor>[2] = {},
  existing?: Y.Doc
) {
  const ydoc =
    existing ?? prosemirrorToYDoc(documentBodyToProseMirror(body), 'body')
  const host = document.createElement('div')
  document.body.append(host)
  const editor = createDocumentBodyEditor(host, ydoc, options)
  return {
    editor,
    ydoc,
    host,
    cleanup() {
      editor.destroy()
      ydoc.destroy()
      host.remove()
    },
  }
}

export function pressKey(
  target: HTMLElement,
  key: string,
  modifiers: {
    ctrlKey?: boolean
    metaKey?: boolean
    shiftKey?: boolean
    altKey?: boolean
  } = {}
) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  })
  target.dispatchEvent(event)
  return event
}

/** Document position of the first run whose text equals `text`. */
export function runStart(
  doc: ReturnType<typeof documentBodyToProseMirror>,
  text: string
) {
  let found = -1
  doc.descendants((node, position) => {
    if (found < 0 && node.type.name === 'run' && node.textContent === text)
      found = position + 1
    return found < 0
  })
  if (found < 0) throw new Error(`no run with text ${text}`)
  return found
}

/**
 * Records, for every edit, the top-level blocks it removed: the observable
 * result of a delete, with no command in between.
 */
export function trackRemovedBlocks(initial: DocumentBodyNode[]) {
  let previous = initial
  const batches: string[][] = []
  return {
    batches,
    onBodyChange(next: DocumentBodyNode[]) {
      const kept = new Set(next.map((node) => node.nodeID))
      const removed = previous
        .filter((node) => node.parentID !== null && !kept.has(node.nodeID))
        .filter((node) =>
          previous.some(
            (parent) =>
              parent.nodeID === node.parentID && parent.parentID === null
          )
        )
        .map((node) => node.nodeID)
      if (removed.length) batches.push(removed)
      previous = next
    },
  }
}
