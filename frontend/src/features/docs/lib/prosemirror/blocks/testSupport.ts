import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state'
import type { DocumentBodyNode } from '../../documentBody'
import {
  documentBodyToProseMirror,
  prosemirrorToDocumentBody,
} from '../documentBody'
import { prepareBodyTransaction } from '../prepareBodyTransaction'

export type Command = (
  state: EditorState,
  dispatch?: (tr: Transaction) => void
) => boolean

export interface BodyBuilder {
  add: (
    parentID: string | null,
    type: string,
    content?: string,
    attributes?: Record<string, unknown>
  ) => string
  nodes: DocumentBodyNode[]
}

export function bodyBuilder(): BodyBuilder {
  const nodes: DocumentBodyNode[] = []
  const orders = new Map<string | null, number>()
  return {
    nodes,
    add(parentID, type, content = '', attributes = {}) {
      const siblingOrder = orders.get(parentID) ?? 0
      orders.set(parentID, siblingOrder + 1)
      const nodeID = `n${nodes.length}`
      nodes.push({ nodeID, parentID, siblingOrder, type, content, attributes })
      return nodeID
    },
  }
}

export function stateFor(
  nodes: DocumentBodyNode[],
  inNode: string,
  offset = 0
): EditorState {
  const doc = documentBodyToProseMirror(nodes)
  let pos = -1
  doc.descendants((node, position) => {
    if (node.attrs.nodeID === inNode) pos = position
    return pos < 0
  })
  if (pos < 0) throw new Error(`node ${inNode} not found`)
  const state = EditorState.create({ doc })
  const node = doc.nodeAt(pos)!
  const target =
    node.isTextblock || node.type.spec.content?.includes('text')
      ? pos + 1 + offset
      : pos + 1
  return state.apply(
    state.tr.setSelection(TextSelection.near(doc.resolve(target)))
  )
}

/** Runs a command and normalizes the transaction as the live editor would. */
export function run(
  state: EditorState,
  command: Command
): { state: EditorState; ok: boolean } {
  let captured: Transaction | undefined
  const ok = command(state, (tr) => {
    captured = tr
  })
  if (!captured) return { state, ok }
  const prepared = prepareBodyTransaction(state, captured)
  return { state: state.apply(prepared), ok }
}

export function bodyOf(doc: ProseMirrorNode) {
  return prosemirrorToDocumentBody(doc)
}
