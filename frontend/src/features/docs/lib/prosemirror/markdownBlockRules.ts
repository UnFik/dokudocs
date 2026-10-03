import { InputRule } from 'prosemirror-inputrules'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import {
  Plugin,
  PluginKey,
  Selection,
  type Transaction,
} from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { createNode } from './blocks/insertBlock'
import { documentBodySchema } from './documentBody'
import { nodeSuggestionOf } from './nodeSuggestion'

// Typing "- ", "1. ", "> ", "[ ] ", "```" or "---" at the start of a line turns
// it into a list, a quote, a task list, a code block or a separator. A line
// cannot be moved into a new parent, so the new block is built after it, with the
// rest of the line's text copied in, and the old line is deleted behind the
// scenes. Until that is done the old line is hidden, and typing is not paused.

const nodes = documentBodySchema.nodes

export type BlockRuleHost = {
  /**
   * The line `originalNodeID` was replaced by a new block after it; remove it.
   * Called after the edit that built the block has been dispatched.
   */
  replaced: (originalNodeID: string) => void
}

export const hiddenNodes = new PluginKey<ReadonlySet<string>>('hiddenNodes')

/** Hides lines that were replaced and are waiting to be deleted. */
export const hiddenNodesPlugin = new Plugin<ReadonlySet<string>>({
  key: hiddenNodes,
  state: {
    init: () => new Set<string>(),
    apply(transaction, value) {
      const hide = transaction.getMeta(hiddenNodes) as string | undefined
      return hide ? new Set([...value, hide]) : value
    },
  },
  props: {
    decorations(state) {
      const hidden = hiddenNodes.getState(state)
      if (!hidden?.size) return null
      const decorations: Decoration[] = []
      state.doc.descendants((node, pos) => {
        if (
          typeof node.attrs.nodeID === 'string' &&
          hidden.has(node.attrs.nodeID)
        )
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, {
              style: 'display: none',
              'aria-hidden': 'true',
            })
          )
        return !node.isTextblock
      })
      return DecorationSet.create(state.doc, decorations)
    },
  },
})

/**
 * The line's text after the prefix, as new runs. `offset` is how far into the
 * paragraph's content the prefix reaches. What is left of the run it is in comes
 * first, then the runs after it; raw text a paragraph holds before the editor
 * has wrapped it goes into a run of its own.
 */
function remainingRuns(paragraph: ProseMirrorNode, offset: number) {
  const runs: ProseMirrorNode[] = []
  const fresh = { nodeID: null, bodyAttributes: '{}', bodyContent: '' }
  paragraph.forEach((child, childStart) => {
    if (childStart + child.nodeSize <= offset) return
    if (child.type.name === 'run') {
      const content = child.content.cut(Math.max(0, offset - childStart - 1))
      if (content.size)
        runs.push(
          child.type.create(
            { ...child.attrs, nodeID: null },
            content,
            child.marks
          )
        )
    } else if (child.isText) {
      const text = child.cut(Math.max(0, offset - childStart))
      if (text.text) runs.push(nodes.run!.create(fresh, [text]))
    }
  })
  return runs
}

const line = (runs: ProseMirrorNode[]) => createNode('paragraph', {}, runs)

type Build = (
  runs: ProseMirrorNode[],
  match: RegExpMatchArray
) => ProseMirrorNode[]

function blockRule(find: RegExp, build: Build, host: BlockRuleHost) {
  return new InputRule(find, (state, match, start, end) => {
    const $start = state.doc.resolve(start)
    // The caret is in a run once a line has one, and in the paragraph itself on
    // an empty line; the prefix has to start the line either way.
    const inRun = $start.parent.type === nodes.run
    const depth = inRun ? $start.depth - 1 : $start.depth
    const paragraph = depth >= 1 ? $start.node(depth) : null
    if (
      !paragraph ||
      paragraph.type !== nodes.paragraph ||
      depth < 2 ||
      $start.node(depth - 1).type.name !== 'document' ||
      start !== $start.start() ||
      (inRun && $start.index(depth) !== 0) ||
      typeof paragraph.attrs.nodeID !== 'string' ||
      nodeSuggestionOf(paragraph)
    )
      return null
    const runs = remainingRuns(paragraph, end - $start.start(depth))
    const blocks = build(runs, match)
    const after = $start.after(depth)
    const tr: Transaction = state.tr.insert(after, blocks)
    const selection = Selection.findFrom(tr.doc.resolve(after), 1, true)
    if (selection) tr.setSelection(selection)
    tr.setMeta(hiddenNodes, paragraph.attrs.nodeID)
    host.replaced(paragraph.attrs.nodeID as string)
    return tr
  })
}

const list = (
  type: 'bullet_list' | 'order_list' | 'task_list',
  attributes: Record<string, unknown>,
  item: 'list_item' | 'task_list_item',
  itemAttributes: Record<string, unknown>,
  runs: ProseMirrorNode[]
) =>
  createNode(type, attributes, [createNode(item, itemAttributes, [line(runs)])])

export function blockMarkdownRules(host: BlockRuleHost) {
  return [
    // "- ", "* " and "+ ": a bulleted list.
    blockRule(
      /^([-*+])\s$/,
      (runs, match) => [
        list(
          'bullet_list',
          { marker: match[1], loose: false },
          'list_item',
          {},
          runs
        ),
      ],
      host
    ),
    // "1. " and "1) ": a numbered list that starts at that number.
    blockRule(
      /^(\d{1,9})([.)])\s$/,
      (runs, match) => [
        list(
          'order_list',
          { start: Number(match[1]), loose: false, delimiter: match[2] },
          'list_item',
          {},
          runs
        ),
      ],
      host
    ),
    // "[ ] " and "[x] ": a task list.
    blockRule(
      /^\[([ xX]?)\]\s$/,
      (runs, match) => [
        list(
          'task_list',
          { marker: '-', loose: false },
          'task_list_item',
          { checked: match[1]!.toLowerCase() === 'x' },
          runs
        ),
      ],
      host
    ),
    // "> ": a quote.
    blockRule(
      /^>\s$/,
      (runs) => [createNode('block_quote', {}, [line(runs)])],
      host
    ),
    // "```" or "```lang" and a space: a code block; the rest of the line is its text.
    blockRule(
      /^```([a-zA-Z0-9_+-]*)\s$/,
      (runs, match) => [
        createNode(
          'code_block',
          { type: 'fenced', lang: match[1] ?? '' },
          runs.map((item) => item.textContent).join('')
        ),
      ],
      host
    ),
    // "---": a separator, with a new line after it for what comes next.
    blockRule(
      /^---$/,
      (runs) => [
        nodes.thematic_break!.create({
          nodeID: null,
          bodyAttributes: '{}',
          bodyContent: '---',
        }),
        line(runs),
      ],
      host
    ),
    // "# " to "###### ": a heading, for a line the in-place heading rule cannot
    // take because the marker is all there is in its run.
    blockRule(
      /^(#{1,6})\s$/,
      (runs, match) => [
        createNode('atx_heading', { level: match[1]!.length }, runs),
      ],
      host
    ),
  ]
}
