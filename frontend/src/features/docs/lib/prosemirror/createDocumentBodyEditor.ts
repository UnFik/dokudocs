import { inputRules, undoInputRule } from 'prosemirror-inputrules'
import { keymap } from 'prosemirror-keymap'
import {
  AllSelection,
  EditorState,
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type Command,
  type Transaction,
} from 'prosemirror-state'
import {
  Decoration,
  DecorationSet,
  EditorView,
  type EditorProps,
} from 'prosemirror-view'
import 'prosemirror-view/style/prosemirror.css'
import {
  absolutePositionToRelativePosition,
  redo as redoYjs,
  relativePositionToAbsolutePosition,
  undo as undoYjs,
  ySyncPlugin,
  ySyncPluginKey,
  yUndoPlugin,
  yUndoPluginKey,
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror'
import * as Y from 'yjs'
import type { RemoteCursor } from '../collab-session'
import type { DocumentBodyNode } from '../documentBody'
import {
  headingInputRule,
  insertBlockCommand,
  setHeadingCommand,
  splitTextBlock,
  toggleTaskChecked,
  type InsertableBlock,
} from './blockCommands'
import { decideSuggestion } from './decideSuggestion'
import {
  caretAfterDelete,
  withEmptiedParents,
  type CaretHint,
} from './deleteTargets'
import { documentBodySchema, prosemirrorToDocumentBody } from './documentBody'
import { headingMarginPlugin } from './headingMargin'
import {
  emptyInlineState,
  readInlineState,
  linkRange,
  removeLinkCommand,
  setLinkCommand,
  toggleInlineMark,
  type InlineMarkName,
  type InlineState,
} from './inlineMarks'
import { joinParagraphs } from './joinParagraphs'
import { blockMarkdownRules } from './markdownBlockRules'
import { inlineMarkdownRules, markRuleResetPlugin } from './markdownInputRules'
import { nodeSuggestionOf } from './nodeSuggestion'
import { prepareBodyTransaction } from './prepareBodyTransaction'
import { planSelectionDeletion, textblockAt } from './selectionDeletion'
import { smartTextRules } from './smartText'
import { suggestionBlocksPlugin } from './suggestionBlocks'
import { suggestionCards, type SuggestionCard } from './suggestionCards'
import {
  blockMenuMeta,
  suggestBlockInsert,
  type BlockMenuMeta,
} from './trackBlockInsert'
import { suggestBlockType, type HeadingLevel } from './trackBlockType'
import {
  suggestDeleteKey,
  suggestReplace,
  trackTransaction,
  UnsupportedSuggestionError,
} from './trackChanges'
import { suggestFormat, suggestLink } from './trackFormat'
import {
  joinTarget,
  suggestEnter,
  suggestDeleteSeparator,
  suggestJoin,
  suggestPasteLines,
} from './trackStructure'

// Marks a transaction the Suggest mode engine built, so it is applied as is.
const trackedMeta = 'trackedSuggestion'

export type MoveNodeIntent = {
  nodeID: string
  targetParentID: string
  beforeNodeID: string | null
}

export interface EditorHistoryState {
  canUndo: boolean
  canRedo: boolean
}

/** The local selection as two encoded Yjs relative positions. */
export interface DocumentBodySelection {
  anchor: Uint8Array
  head: Uint8Array
}

const safeColor = /^#[0-9A-Fa-f]{6}$/

export interface DocumentBodyAnchor {
  nodeID: string
  start: Uint8Array
  end: Uint8Array
}

export function createDocumentBodyEditor(
  mount: HTMLElement,
  ydoc: Y.Doc,
  options: {
    readOnly?: boolean
    /** Whether typographic replacements (curly quotes, arrows, ellipsis) apply as the person types. */
    smartText?: () => boolean
    /** The person asked for a link to a heading (its node ID). */
    onHeadingLink?: (nodeID: string) => void
    /** Arrow up from the very start of the text: the title is the line above. */
    onNavigateToTitle?: () => void
    plugins?: Plugin[]
    nodeViews?: EditorProps['nodeViews']
    onEditorReady?: (view: EditorView) => void
    onBodyChange?: (body: DocumentBodyNode[]) => void
    onTransactionError?: (error: unknown) => void
    onHistoryChange?: (history: EditorHistoryState) => void
    onInlineStateChange?: (state: InlineState) => void
    onLinkRequest?: () => void
    /** Suggest mode: an edit that cannot become a suggestion. */
    onSuggestRefused?: (message: string) => void
    /** The user whose edits Suggest mode records; a UUID. */
    suggestAuthor?: string
    /** The suggestions in the body changed. */
    onSuggestionCards?: (cards: SuggestionCard[]) => void
    onSuggestionClick?: (id: string) => void
    /** Where each comment thread sits now: a document position, or null when its text is gone. */
    onCommentPositions?: (positions: Record<string, number | null>) => void
    onCommentClick?: (id: string) => void
    /** The user asked to comment on the selection (Ctrl or Cmd with Alt and M). */
    onCommentRequest?: () => void
    /** Fires when the local selection moves; null when the editor loses focus. */
    onSelectionChange?: (selection: DocumentBodySelection | null) => void
  } = {}
) {
  const fragment = ydoc.getXmlFragment('body')
  let readOnly = options.readOnly ?? false
  let suggestMode = false
  let continueSuggestion = false
  const suggestionFocusKey = new PluginKey<string | null>('suggestionFocus')
  const suggestionFocusPlugin = new Plugin<string | null>({
    key: suggestionFocusKey,
    state: {
      init: (): string | null => null,
      apply: (transaction, focusedID) =>
        transaction.getMeta(suggestionFocusKey) ?? focusedID,
    },
    props: {
      decorations: (editorState): DecorationSet => {
        const focusedID = suggestionFocusKey.getState(editorState)
        if (!focusedID) return DecorationSet.empty
        const decorations: Decoration[] = []
        editorState.doc.descendants((node, pos) => {
          if (node.isText) {
            if (
              node.marks.some(
                (mark) =>
                  mark.type.name.startsWith('suggestion_') &&
                  mark.attrs.id === focusedID
              )
            )
              decorations.push(
                Decoration.inline(pos, pos + node.nodeSize, {
                  class: 'suggestion-focus',
                  'data-suggestion-focus-id': focusedID,
                })
              )
            return false
          }
          if (nodeSuggestionOf(node)?.id === focusedID)
            decorations.push(
              Decoration.node(pos, pos + node.nodeSize, {
                class: 'suggestion-focus',
                'data-suggestion-focus-id': focusedID,
              })
            )
          return true
        })
        return DecorationSet.create(editorState.doc, decorations)
      },
    },
  })
  // Comment threads are not part of the body (ADR 0027). Their text is marked
  // here, from anchors the server keeps, so a comment follows its words.
  const commentsKey = new PluginKey('comments')
  type CommentThreadAnchor = {
    id: string
    anchor: DocumentBodyAnchor | null
    resolved: boolean
  }
  let commentThreads: CommentThreadAnchor[] = []
  let commentRanges: { id: string; from: number; to: number }[] = []
  let focusedCommentID: string | null = null
  let lastCommentState = ''
  const commentsPlugin = new Plugin({
    key: commentsKey,
    props: {
      decorations: (editorState): DecorationSet => {
        const size = editorState.doc.content.size
        return DecorationSet.create(
          editorState.doc,
          commentRanges
            .filter((range) => range.to <= size)
            .map((range) =>
              Decoration.inline(range.from, range.to, {
                class:
                  range.id === focusedCommentID
                    ? 'comment-mark comment-focus'
                    : 'comment-mark',
                'data-comment-id': range.id,
              })
            )
        )
      },
    },
  })
  let remoteCursors: RemoteCursor[] = []
  const remoteCursorPlugin = new Plugin({
    props: {
      decorations: (editorState) => remoteCursorDecorations(editorState),
    },
  })
  let state = EditorState.create({
    doc: yXmlFragmentToProseMirrorRootNode(fragment, documentBodySchema),
    plugins: [
      ySyncPlugin(fragment),
      yUndoPlugin(),
      remoteCursorPlugin,
      suggestionFocusPlugin,
      headingMarginPlugin((nodeID) => options.onHeadingLink?.(nodeID)),
      suggestionBlocksPlugin,
      commentsPlugin,
      // Block plugins (slash menu, drag handle) run before the keymaps below so
      // they can claim Enter and arrow keys while a menu is open.
      ...(options.plugins ?? []),
      markRuleResetPlugin,
      inputRules({
        rules: [
          headingInputRule,
          ...blockMarkdownRules(),
          ...inlineMarkdownRules,
          ...smartTextRules(options.smartText ?? (() => false)),
        ],
      }),
      keymap({
        Enter: (_state, _dispatch, editorView) => {
          if (!suggestMode) return runBlock(splitTextBlock)
          if (!canEdit() || !editorView) return false
          const current = stateAtDomSelection(editorView)
          suggest(() => suggestEnter(current, suggestionOptions()))
          return true
        },
        'Ctrl-Enter': () => runBlock(toggleTaskChecked),
        'Meta-Enter': () => runBlock(toggleTaskChecked),
        'Ctrl-Alt-c': () => runBlock(insertBlockCommand('code-block')),
        'Meta-Alt-c': () => runBlock(insertBlockCommand('code-block')),
        'Ctrl-Alt--': () => runBlock(insertBlockCommand('thematic-break')),
        'Meta-Alt--': () => runBlock(insertBlockCommand('thematic-break')),
        ...Object.fromEntries(
          ([0, 1, 2, 3, 4, 5, 6] as const).flatMap((level) =>
            ['Ctrl', 'Meta'].map((modifier) => [
              `${modifier}-Alt-${level}`,
              () => runHeading(level),
            ])
          )
        ),
      }),
      keymap(
        bindControlAndMeta({
          b: () => runInlineMark('strong'),
          i: () => runInlineMark('em'),
          e: () => runInlineMark('code'),
          'Shift-x': () => runInlineMark('strike'),
          u: () => runInlineMark('underline'),
          'Alt-m': () => {
            options.onCommentRequest?.()
            return true
          },
          k: () => {
            if (!canEdit()) return true
            options.onLinkRequest?.()
            return true
          },
          a: () => {
            selectAllContent()
            return true
          },
          z: () => runHistory(undoYjs),
          'Shift-z': () => runHistory(redoYjs),
          y: () => runHistory(redoYjs),
        })
      ),
    ],
  })
  const canEdit = () => !readOnly
  // Select all stays inside the document body. In read-only mode there is no
  // caret, so the selection is set on the DOM instead.
  const selectAllContent = () => {
    const view = viewHolder.current
    if (!view) return
    if (readOnly) {
      const range = window.document.createRange()
      range.selectNodeContents(view.dom)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }
    view.focus()
    view.dispatch(view.state.tr.setSelection(new AllSelection(state.doc)))
  }
  // A shortcut swallowed while read-only must not fall through to the browser's
  // own contenteditable history, which would bypass the Yjs undo manager.
  const runHistory = (action: (state: EditorState) => boolean) => {
    continueSuggestion = false
    if (canEdit()) action(state)
    return true
  }
  // In Suggest mode a format on a selection is proposed, not applied. With a
  // caret there is nothing to propose: what is typed next is your own insertion.
  const runInlineMark = (name: InlineMarkName) => {
    if (!suggestMode || !canEdit() || state.selection.empty)
      return runInline(toggleInlineMark(name))
    const view = viewHolder.current
    if (view)
      suggest(() =>
        suggestFormat(stateAtDomSelection(view), name, suggestionOptions())
      )
    return true
  }
  // In Suggest mode a block's type is proposed, not changed.
  const runHeading = (level: HeadingLevel) => {
    if (!suggestMode) return runBlock(setHeadingCommand(level))
    if (!canEdit()) return false
    const view = viewHolder.current
    if (view)
      suggest(() =>
        suggestBlockType(stateAtDomSelection(view), level, suggestionOptions())
      )
    return true
  }
  const runInline = (command: Command) => {
    if (canEdit()) command(state, (tr) => viewHolder.current?.dispatch(tr))
    return true
  }
  const runBlock = (command: Command) => {
    if (!canEdit()) return false
    return command(state, (tr) => viewHolder.current?.dispatch(tr))
  }
  let lastInline = emptyInlineState
  const publishInline = () => {
    const view = viewHolder.current
    if (!view) return
    const next = readInlineState(view)
    if (JSON.stringify(next) === JSON.stringify(lastInline)) return
    lastInline = next
    options.onInlineStateChange?.(next)
  }
  const readHistory = (): EditorHistoryState => {
    const undoManager = yUndoPluginKey.getState(state)?.undoManager
    return {
      canUndo: undoManager?.canUndo() ?? false,
      canRedo: undoManager?.canRedo() ?? false,
    }
  }
  let lastHistory = readHistory()
  const publishHistory = () => {
    const next = readHistory()
    if (
      next.canUndo === lastHistory.canUndo &&
      next.canRedo === lastHistory.canRedo
    )
      return
    lastHistory = next
    options.onHistoryChange?.(next)
  }

  const resolveRelative = (
    editorState: EditorState,
    encoded: Uint8Array
  ): number | null => {
    try {
      const mapping = ySyncPluginKey.getState(editorState)?.binding.mapping
      if (!mapping) return null
      const position = relativePositionToAbsolutePosition(
        ydoc,
        fragment,
        Y.decodeRelativePosition(encoded),
        mapping
      )
      return position !== null && position <= editorState.doc.content.size
        ? position
        : null
    } catch {
      return null
    }
  }

  const remoteCursorDecorations = (editorState: EditorState) => {
    const decorations: Decoration[] = []
    for (const cursor of remoteCursors) {
      if (!cursor.anchor || !cursor.head) continue
      const anchor = resolveRelative(editorState, cursor.anchor)
      const head = resolveRelative(editorState, cursor.head)
      if (anchor === null || head === null) continue
      const color =
        cursor.color && safeColor.test(cursor.color) ? cursor.color : null
      const style = color ? `--cursor-color: ${color}` : ''
      if (anchor !== head)
        decorations.push(
          Decoration.inline(Math.min(anchor, head), Math.max(anchor, head), {
            class: 'remote-selection',
            style,
          })
        )
      decorations.push(
        Decoration.widget(
          head,
          () => {
            const caret = document.createElement('span')
            caret.className = 'remote-cursor'
            if (color) caret.style.setProperty('--cursor-color', color)
            // The name is drawn by CSS from data-name so it never becomes
            // document text: it must not be copied or break text assertions.
            caret.dataset.name = cursor.name || 'Collaborator'
            return caret
          },
          { key: `cursor-${cursor.connectionID}-${head}-${color}`, side: 1 }
        )
      )
    }
    return DecorationSet.create(editorState.doc, decorations)
  }

  const toRelativeSelection = (
    editorState: EditorState
  ): DocumentBodySelection | null => {
    const mapping = ySyncPluginKey.getState(editorState)?.binding.mapping
    if (!mapping) return null
    const { anchor, head } = editorState.selection
    return {
      anchor: Y.encodeRelativePosition(
        absolutePositionToRelativePosition(anchor, fragment, mapping)
      ),
      head: Y.encodeRelativePosition(
        absolutePositionToRelativePosition(head, fragment, mapping)
      ),
    }
  }
  const viewHolder: { current?: EditorView } = {}
  /** Puts the caret at the start or end of a text block and focuses the editor. */
  const focusBlockAt = (nodeID: string, edge: 'start' | 'end') => {
    const view = viewHolder.current
    if (!view) return false
    let target: { pos: number; size: number } | null = null
    state.doc.descendants((node, pos) => {
      if (target) return false
      if (node.attrs.nodeID === nodeID && node.isTextblock)
        target = { pos, size: node.nodeSize }
      return !target
    })
    if (!target) return false
    const { pos, size } = target as { pos: number; size: number }
    const at = edge === 'start' ? pos + 1 : pos + size - 1
    view.dispatch(
      state.tr.setSelection(
        TextSelection.near(state.doc.resolve(at), edge === 'start' ? 1 : -1)
      )
    )
    view.focus()
    return true
  }

  // Removes whole blocks (or runs) by node ID as one edit and puts the caret
  // where the removed text was. The editor is the only writer, so the delete is
  // applied at once: there is no command to wait for and nothing to rebuild.
  const queueDeleteNode = (
    requested: string[],
    { hint }: { hint?: CaretHint | null } = {}
  ) => {
    const nodeIDs = withEmptiedParents(state.doc, requested)
    const caret =
      hint === undefined ? caretAfterDelete(state.doc, nodeIDs) : hint
    const targets = new Set(nodeIDs)
    const ranges: { from: number; to: number }[] = []
    state.doc.descendants((node, pos) => {
      if (node.isText) return false
      if (targets.has(node.attrs.nodeID as string)) {
        ranges.push({ from: pos, to: pos + node.nodeSize })
        return false
      }
      return true
    })
    if (!ranges.length) return false
    let tr = state.tr
    for (const range of ranges.reverse()) tr = tr.delete(range.from, range.to)
    // Applied as is, also in Suggest mode: accepting a suggestion removes blocks.
    viewHolder.current?.dispatch(tr.setMeta(trackedMeta, true))
    if (caret) focusBlockAt(caret.nodeID, caret.edge)
    return true
  }

  // The editor reads the browser's selection after a selectionchange event, so a
  // key pressed right after the caret moved (End, an arrow, a click) can find the
  // editor's selection one step behind. Delete and Backspace read the DOM
  // selection directly for a text caret or range; a node or select-all selection
  // is always set by the editor itself.
  const selectionNow = (editorView: EditorView): Selection => {
    const current = editorView.state.selection
    if (!(current instanceof TextSelection)) return current
    try {
      const range = window.getSelection()
      if (
        !range ||
        !range.anchorNode ||
        !range.focusNode ||
        !editorView.dom.contains(range.anchorNode) ||
        !editorView.dom.contains(range.focusNode)
      )
        return current
      const doc = editorView.state.doc
      return TextSelection.between(
        doc.resolve(editorView.posAtDOM(range.anchorNode, range.anchorOffset)),
        doc.resolve(editorView.posAtDOM(range.focusNode, range.focusOffset))
      )
    } catch {
      return current
    }
  }
  /** The editor state with the selection the browser has now, not the one the editor last heard of. */
  const stateAtDomSelection = (editorView: EditorView) => {
    const selection = selectionNow(editorView)
    return selection === editorView.state.selection
      ? editorView.state
      : editorView.state.apply(editorView.state.tr.setSelection(selection))
  }

  // Delete with a selection that is not inside one textblock (select all, a
  // separator, text across blocks). The browser's own deletion is ignored by the
  // editor for these, so it is done here: whole blocks and runs go through
  // DeleteNode as one batch, and text left at the ends is trimmed as an edit.
  const deleteAcrossBlocks = (selection: Selection) => {
    if (selection.empty) return false
    const first = textblockAt(state.doc, selection.from)
    if (
      !(selection instanceof NodeSelection) &&
      first &&
      first === textblockAt(state.doc, selection.to)
    )
      return false
    const plan = planSelectionDeletion(state.doc, selection.from, selection.to)
    // A selection with nothing to delete does nothing, and says nothing.
    if (!plan.ok) return true
    if (plan.trims.length) {
      let trim = state.tr
      for (const range of [...plan.trims].reverse())
        trim = trim.delete(range.from, range.to)
      viewHolder.current?.dispatch(trim)
    }
    if (plan.roots.length) queueDeleteNode(plan.roots)
    return true
  }

  // Delete or Backspace over a selection inside one paragraph. Text that leaves
  // a run with some text is an ordinary edit, left to the browser. A run whose
  // whole text is selected would end up empty, and a canonical run cannot be
  // emptied by an edit: it goes through DeleteNode, with the text left at the
  // ends trimmed, as for a selection across blocks.
  const deleteWholeRuns = (selection: Selection) => {
    if (selection.empty || !(selection instanceof TextSelection)) return false
    const { $from, $to } = selection
    let depth = $from.depth
    while (depth > 0 && !$from.node(depth).isTextblock) depth--
    if (
      depth === 0 ||
      $to.depth < depth ||
      $to.node(depth) !== $from.node(depth)
    )
      return false
    const block = $from.node(depth)
    const roots: string[] = []
    const trims: { from: number; to: number }[] = []
    let onlyRuns = true
    block.forEach((child, offset) => {
      const nodeID = child.attrs.nodeID
      if (child.type.name !== 'run' || typeof nodeID !== 'string') {
        onlyRuns = false
        return
      }
      const textStart = $from.start(depth) + offset + 1
      const textEnd = textStart + child.content.size
      const from = Math.max(selection.from, textStart)
      const to = Math.min(selection.to, textEnd)
      if (from >= to) return
      if (from === textStart && to === textEnd) roots.push(nodeID)
      else trims.push({ from, to })
    })
    if (!onlyRuns || !roots.length) return false
    if (trims.length) {
      let trim = state.tr
      for (const range of [...trims].reverse())
        trim = trim.delete(range.from, range.to)
      viewHolder.current?.dispatch(trim)
    }
    return queueDeleteNode(roots)
  }

  // Ctrl or Alt with Backspace or Delete: the browser finds the word, then the
  // selection it made is deleted by the same routes as any other selection, so a
  // word that is a whole run does not hit the guard against emptying a run.
  const deleteWord = (forward: boolean) => {
    const range = window.getSelection()
    if (!range || !range.isCollapsed) return false
    const { anchorNode, anchorOffset } = range
    range.modify('extend', forward ? 'forward' : 'backward', 'word')
    const selection = selectionNow(viewHolder.current!)
    if (selection.empty) {
      joinNeighbours(forward)
      return true
    }
    const { $from, $to } = selection
    const blockOf = ($pos: typeof $from) => {
      for (let depth = $pos.depth; depth > 0; depth--)
        if ($pos.node(depth).isTextblock) return $pos.node(depth)
      return null
    }
    // On an empty line, or at the edge of one, the word runs into the next
    // block. That is a plain Delete or Backspace: the lines join, or the empty
    // one goes. The caret goes back first so the join starts from where it was.
    if (blockOf($from) !== blockOf($to)) {
      if (anchorNode) range.collapse(anchorNode, anchorOffset)
      joinNeighbours(forward)
      return true
    }
    if (deleteWholeRuns(selection)) return true
    if (!(selection instanceof TextSelection)) return false
    const tr = state.tr.delete(selection.from, selection.to)
    tr.setSelection(TextSelection.create(tr.doc, selection.from))
    viewHolder.current?.dispatch(tr)
    return true
  }

  // Backspace at the start of a paragraph, or Delete at the end of the one
  // before: the two become one. The text goes up as an edit first, then the
  // lower paragraph is deleted.
  const joinNeighbours = (forward: boolean) => {
    const current = stateAtDomSelection(viewHolder.current!)
    const upper = joinTarget(current, forward)
    if (upper === null) return false
    const join = joinParagraphs(current, upper)
    if (!join) {
      // Next to a table or a code block there is nothing to merge into: the
      // caret moves into it, as it would in any editor.
      const first = current.doc.nodeAt(upper)
      const next = first ? current.doc.nodeAt(upper + first.nodeSize) : null
      const target = forward ? next : first
      const targetPos = forward && first ? upper + first.nodeSize : upper
      if (
        target &&
        ['table', 'code_block', 'math_block', 'diagram'].includes(
          target.type.name
        )
      ) {
        const at = forward ? targetPos + 1 : targetPos + target.nodeSize - 1
        viewHolder.current?.dispatch(
          current.tr.setSelection(
            TextSelection.near(current.doc.resolve(at), forward ? 1 : -1)
          )
        )
        return true
      }
      return false
    }
    if (join.transaction) viewHolder.current?.dispatch(join.transaction)
    return queueDeleteNode([join.deleteNodeID])
  }

  // Delete at the end of a paragraph, or Backspace at the start of one, next to
  // a separator removes the separator. The browser has nothing to merge with, so
  // it does nothing on its own.
  const deleteNeighbouringSeparator = (
    key: 'Delete' | 'Backspace',
    selection: Selection
  ) => {
    if (!selection.empty) return false
    const $pos = selection.$from
    let depth = $pos.depth
    while (depth > 0 && !$pos.node(depth).isTextblock) depth--
    if (depth === 0) return false
    // The caret may sit inside the first or last run or between runs, so the
    // edge is "no text and no inline leaf between the caret and the block's end".
    const emptyBetween = (from: number, to: number) =>
      state.doc.textBetween(from, to, '', '\ufffc') === ''
    const atEdge =
      key === 'Delete'
        ? emptyBetween($pos.pos, $pos.end(depth))
        : emptyBetween($pos.start(depth), $pos.pos)
    if (!atEdge) return false
    const parent = $pos.node(depth - 1)
    const index = $pos.index(depth - 1)
    const neighbour = parent.maybeChild(
      key === 'Delete' ? index + 1 : index - 1
    )
    const nodeID = neighbour?.attrs.nodeID
    if (neighbour?.type.name !== 'thematic_break' || typeof nodeID !== 'string')
      return false
    return queueDeleteNode([nodeID])
  }

  const suggestAuthor = () => {
    if (!options.suggestAuthor)
      throw new UnsupportedSuggestionError('You cannot suggest changes here.')
    return options.suggestAuthor
  }
  const suggestionOptions = () => ({
    author: suggestAuthor(),
    continueAdjacent: continueSuggestion,
  })

  // Applies the edit a function builds as a suggestion. What it cannot record
  // is refused with a message; nothing changes.
  const suggest = (build: () => Transaction) => {
    try {
      const transaction = build()
      if (transaction.docChanged) {
        const before = state.doc
        viewHolder.current?.dispatch(
          transaction.setMeta(trackedMeta, true).scrollIntoView()
        )
        continueSuggestion = state.doc !== before
      } else if (transaction.selectionSet)
        viewHolder.current?.dispatch(transaction)
    } catch (error) {
      if (!(error instanceof UnsupportedSuggestionError)) throw error
      options.onSuggestRefused?.(error.message)
    }
  }

  let lastCards = '[]'
  const publishSuggestionCards = () => {
    if (!options.onSuggestionCards) return
    const cards = suggestionCards(state.doc)
    const encoded = JSON.stringify(cards)
    if (encoded === lastCards) return
    lastCards = encoded
    options.onSuggestionCards(cards)
  }

  const dispatchTransaction = (transaction: Transaction) => {
    const remote = transaction.getMeta(ySyncPluginKey)?.isChangeOrigin === true
    const tracked = transaction.getMeta(trackedMeta) === true
    if (
      remote ||
      (transaction.selectionSet && !transaction.docChanged && !tracked)
    )
      continueSuggestion = false
    let prepared = transaction

    try {
      if (readOnly && transaction.docChanged && !remote) return
      const menu = transaction.getMeta(blockMenuMeta) as
        | BlockMenuMeta
        | undefined
      if (suggestMode && menu && transaction.docChanged && !remote) {
        // A block from the "/" menu: a heading changes the level of the
        // paragraph, anything else is added after it, both as suggestions.
        suggest(() =>
          menu.headingLevel
            ? suggestBlockType(
                state,
                menu.headingLevel as HeadingLevel,
                suggestionOptions()
              )
            : suggestBlockInsert(state, transaction, suggestionOptions())
        )
        viewHolder.current?.updateState(state)
        return
      }
      if (suggestMode && transaction.docChanged && !remote && !tracked) {
        // An edit the browser made itself (an input method, a drop): recorded
        // as a suggestion if it is plain text, refused otherwise.
        suggest(() => trackTransaction(state, transaction, suggestionOptions()))
        viewHolder.current?.updateState(state)
        return
      }
      if (transaction.docChanged && !remote) {
        prepared = prepareBodyTransaction(state, transaction)
      }
      const result = state.applyTransaction(prepared)
      state = result.state
      viewHolder.current?.updateState(state)
      if (result.transactions.some((item) => item.docChanged)) {
        options.onBodyChange?.(prosemirrorToDocumentBody(state.doc))
        publishSuggestionCards()
        refreshComments()
      }
      publishInline()
      // Deleting every block leaves no line to type on: add one.
      if (!remote && state.doc.firstChild?.childCount === 0)
        queueMicrotask(() => ensureEmptyParagraph())
      if (
        options.onSelectionChange &&
        !remote &&
        (transaction.selectionSet || transaction.docChanged)
      ) {
        const selection = toRelativeSelection(state)
        if (selection) options.onSelectionChange(selection)
      }
    } catch (error) {
      options.onTransactionError?.(error)
    }
  }

  // Defined before the view: creating it can already dispatch a transaction.
  const createAnchorFor = (from: number, to: number): DocumentBodyAnchor => {
    const nodeID = blockNodeIDAt(state.doc, from)
    if (from >= to || blockNodeIDAt(state.doc, to) !== nodeID)
      throw new Error('comment anchor must stay within one block')
    const mapping = ySyncPluginKey.getState(state)?.binding.mapping
    if (!mapping) throw new Error('editor Yjs mapping is unavailable')
    return {
      nodeID,
      start: Y.encodeRelativePosition(
        absolutePositionToRelativePosition(from, fragment, mapping)
      ),
      end: Y.encodeRelativePosition(
        absolutePositionToRelativePosition(to, fragment, mapping)
      ),
    }
  }
  const resolveAnchorRange = (anchor: DocumentBodyAnchor) => {
    try {
      const mapping = ySyncPluginKey.getState(state)?.binding.mapping
      if (!mapping) return null
      const from = relativePositionToAbsolutePosition(
        ydoc,
        fragment,
        Y.decodeRelativePosition(anchor.start),
        mapping
      )
      const to = relativePositionToAbsolutePosition(
        ydoc,
        fragment,
        Y.decodeRelativePosition(anchor.end),
        mapping
      )
      if (
        from === null ||
        to === null ||
        from >= to ||
        blockNodeIDAt(state.doc, from) !== anchor.nodeID ||
        blockNodeIDAt(state.doc, to) !== anchor.nodeID
      )
        return null
      return { from, to }
    } catch {
      return null
    }
  }
  // Works out where every comment thread is now, and redraws the marks only
  // when something moved.
  const refreshComments = () => {
    const view = viewHolder.current
    if (!view) return
    const positions: Record<string, number | null> = {}
    const ranges: { id: string; from: number; to: number }[] = []
    for (const thread of commentThreads) {
      const range = thread.anchor ? resolveAnchorRange(thread.anchor) : null
      positions[thread.id] = range ? range.from : null
      if (range && !thread.resolved)
        ranges.push({ id: thread.id, from: range.from, to: range.to })
    }
    const encoded = JSON.stringify([ranges, positions])
    if (encoded === lastCommentState) return
    lastCommentState = encoded
    commentRanges = ranges
    options.onCommentPositions?.(positions)
    view.dispatch(view.state.tr.setMeta(commentsKey, 'refresh'))
  }

  const view = new EditorView(mount, {
    state,
    nodeViews: options.nodeViews,
    dispatchTransaction,
    editable: () => !readOnly,
    handleTextInput: (_view, from, to, text) => {
      if (!suggestMode) return false
      suggest(() => suggestReplace(state, from, to, text, suggestionOptions()))
      return true
    },
    handlePaste: (editorView, event) => {
      if (!suggestMode) return false
      const text = event.clipboardData?.getData('text/plain') ?? ''
      if (!text) return true
      const current = stateAtDomSelection(editorView)
      const { from, to } = current.selection
      if (/[\r\n]/.test(text)) {
        suggest(() => suggestPasteLines(current, text, suggestionOptions()))
        return true
      }
      suggest(() =>
        suggestReplace(current, from, to, text, suggestionOptions())
      )
      return true
    },
    handleDOMEvents: {
      blur: () => {
        options.onSelectionChange?.(null)
        return false
      },
    },
    handleClick: (_editorView, _pos, event) => {
      if (!(event.target instanceof Element)) return false
      const suggestionID = event.target.closest<HTMLElement>(
        '[data-suggestion-id]'
      )?.dataset.suggestionId
      if (suggestionID) options.onSuggestionClick?.(suggestionID)
      else {
        const commentID =
          event.target.closest<HTMLElement>('[data-comment-id]')?.dataset
            .commentId
        if (commentID) options.onCommentClick?.(commentID)
      }
      return false
    },
    // A separator is not selectable by default (it is an atom), so a click on it
    // would only move the caret. Select it, so Delete can remove it.
    handleClickOn: (editorView, _pos, node, nodePos, _event, direct) => {
      if (
        !direct ||
        readOnly ||
        suggestMode ||
        node.type.name !== 'thematic_break'
      )
        return false
      editorView.dispatch(
        editorView.state.tr.setSelection(
          NodeSelection.create(editorView.state.doc, nodePos)
        )
      )
      return true
    },
    handleKeyDown: (editorView, event) => {
      // Keys pressed during IME composition belong to the input method.
      if (readOnly || event.isComposing) return false
      // In Suggest mode Backspace and Delete are recorded as deletions; blocks
      // are not queued commands on the canonical body.
      if (suggestMode) {
        if (
          (event.key !== 'Backspace' && event.key !== 'Delete') ||
          event.shiftKey ||
          event.metaKey
        )
          return false
        const forward = event.key === 'Delete'
        // A separator that is selected: its deletion is proposed.
        const picked = selectionNow(editorView)
        if (
          picked instanceof NodeSelection &&
          picked.node.type.name === 'thematic_break'
        ) {
          suggest(() =>
            suggestDeleteSeparator(state, picked.from, suggestionOptions())
          )
          event.preventDefault()
          return true
        }
        if (!event.ctrlKey && !event.altKey) {
          const current = stateAtDomSelection(editorView)
          const upper = joinTarget(current, forward)
          if (upper !== null) {
            suggest(() => suggestJoin(current, upper, suggestionOptions()))
            event.preventDefault()
            return true
          }
        }
        suggest(() =>
          suggestDeleteKey(
            state,
            selectionNow(editorView),
            {
              forward: event.key === 'Delete',
              word: event.ctrlKey || event.altKey,
            },
            suggestionOptions()
          )
        )
        event.preventDefault()
        return true
      }
      if (
        (event.altKey || event.ctrlKey) &&
        !(event.altKey && event.ctrlKey) &&
        !event.metaKey &&
        !event.shiftKey &&
        (event.key === 'Backspace' || event.key === 'Delete') &&
        deleteWord(event.key === 'Delete')
      ) {
        event.preventDefault()
        return true
      }
      if (
        event.key === 'ArrowUp' &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        options.onNavigateToTitle &&
        editorView.state.selection.empty &&
        state.doc.textBetween(
          0,
          editorView.state.selection.from,
          '\n',
          '\ufffc'
        ) === ''
      ) {
        event.preventDefault()
        options.onNavigateToTitle()
        return true
      }
      // Right after a Markdown rule changed the line, Backspace gives the typed text back.
      if (
        event.key === 'Backspace' &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        undoInputRule(editorView.state, (tr) => editorView.dispatch(tr))
      ) {
        event.preventDefault()
        return true
      }
      if (
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        (event.key === 'Backspace' || event.key === 'Delete')
      ) {
        const nodeID = fullySelectedBlockNodeID(selectionNow(editorView))
        if (nodeID && queueDeleteNode([nodeID])) {
          event.preventDefault()
          return true
        }
      }
      if (
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        (event.key === 'Backspace' || event.key === 'Delete') &&
        (deleteAcrossBlocks(selectionNow(editorView)) ||
          deleteWholeRuns(selectionNow(editorView)) ||
          joinNeighbours(event.key === 'Delete') ||
          deleteNeighbouringSeparator(
            event.key as 'Delete' | 'Backspace',
            selectionNow(editorView)
          ))
      ) {
        event.preventDefault()
        return true
      }
      if (
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
      )
        return false

      const $from = editorView.state.selection.$from
      let depth = $from.depth
      while (depth > 0 && !$from.node(depth).isBlock) depth--
      if (depth === 0) return false

      const parentDepth = depth - 1
      const parent = $from.node(parentDepth)
      const index = $from.index(parentDepth)
      const node = $from.node(depth)
      const from = $from.before(depth)
      const neighborIndex = index + (event.key === 'ArrowUp' ? -1 : 1)
      if (neighborIndex < 0 || neighborIndex >= parent.childCount) return false

      const neighbor = parent.child(neighborIndex)
      const insertAt =
        event.key === 'ArrowUp'
          ? from - neighbor.nodeSize
          : from + neighbor.nodeSize
      const transaction = editorView.state.tr
        .delete(from, from + node.nodeSize)
        .insert(insertAt, node)
      event.preventDefault()
      editorView.dispatch(transaction)
      return true
    },
  })
  viewHolder.current = view
  // Room to click below the last block, as on any page: it puts the caret on a
  // line there, adding a paragraph first when the page ends in a block that has
  // no text line (code block, table, list). Suggest mode only moves the caret.
  const pageEnd = document.createElement('div')
  pageEnd.className = 'dd-page-end'
  pageEnd.setAttribute('aria-hidden', 'true')
  pageEnd.addEventListener('click', () => {
    if (!canEdit()) return
    const body = state.doc.firstChild
    const last = body?.lastChild
    if (
      body &&
      last &&
      !suggestMode &&
      last.type !== documentBodySchema.nodes.paragraph
    )
      view.dispatch(
        state.tr.insert(
          body.content.size + 1,
          documentBodySchema.nodes.paragraph!.create({
            nodeID: crypto.randomUUID(),
            bodyAttributes: '{}',
            bodyContent: '',
          })
        )
      )
    view.dispatch(state.tr.setSelection(Selection.atEnd(state.doc)))
    view.focus()
  })
  mount.append(pageEnd)
  const ensureEmptyParagraph = () => {
    const body = state.doc.firstChild
    if (!canEdit() || suggestMode || body?.childCount !== 0) return
    const tr = state.tr.insert(1, documentBodySchema.nodes.paragraph!.create())
    view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(2))))
  }
  options.onEditorReady?.(view)
  if (view.state !== state) view.updateState(state)
  const undoManager = yUndoPluginKey.getState(state)?.undoManager
  undoManager?.on('stack-item-added', publishHistory)
  undoManager?.on('stack-item-popped', publishHistory)
  undoManager?.on('stack-cleared', publishHistory)
  ensureEmptyParagraph()
  publishSuggestionCards()

  return {
    view,
    ydoc,
    getBody: () => prosemirrorToDocumentBody(state.doc),
    createAnchor: (from: number, to: number): DocumentBodyAnchor =>
      createAnchorFor(from, to),
    resolveAnchor: (anchor: DocumentBodyAnchor) => resolveAnchorRange(anchor),
    /** The comment threads to mark and place; call again whenever they change. */
    setComments: (threads: CommentThreadAnchor[]) => {
      commentThreads = threads
      lastCommentState = ''
      refreshComments()
    },
    setFocusedComment: (id: string | null) => {
      focusedCommentID = id
      view.dispatch(view.state.tr.setMeta(commentsKey, 'focus'))
    },
    scrollToComment: (id: string) => {
      const target = [
        ...view.dom.querySelectorAll<HTMLElement>('[data-comment-id]'),
      ].find((element) => element.dataset.commentId === id)
      if (!target) return false
      focusedCommentID = id
      view.dispatch(view.state.tr.setMeta(commentsKey, 'focus'))
      target.scrollIntoView({ block: 'center' })
      return true
    },
    /** What a new comment would be anchored to: the current selection, in one block. */
    getCommentDraft: ():
      | { ok: true; anchor: DocumentBodyAnchor; selectedText: string }
      | { ok: false; message: string } => {
      const selection = selectionNow(view)
      if (selection.empty)
        return { ok: false, message: 'Select the text to comment on first.' }
      try {
        const anchor = createAnchorFor(selection.from, selection.to)
        return {
          ok: true,
          anchor,
          selectedText: state.doc
            .textBetween(selection.from, selection.to, ' ')
            .slice(0, 500),
        }
      } catch {
        return {
          ok: false,
          message: 'A comment can cover text inside one paragraph at a time.',
        }
      }
    },
    getHistory: readHistory,
    getInlineState: () => readInlineState(view),
    toggleMark: (name: InlineMarkName) => {
      if (!canEdit()) return false
      if (suggestMode && !state.selection.empty) {
        runInlineMark(name)
        return true
      }
      return toggleInlineMark(name)(state, view.dispatch)
    },
    setLink: (href: string) => {
      if (!canEdit()) return false
      if (!suggestMode || state.selection.empty)
        return setLinkCommand(href)(state, view.dispatch)
      // A link on a selection is proposed, not applied.
      let proposed = false
      suggest(() => {
        const transaction = suggestLink(
          stateAtDomSelection(view),
          state.selection,
          href,
          suggestionOptions()
        )
        proposed = transaction.docChanged
        return transaction
      })
      return proposed
    },
    removeLink: () => {
      if (!canEdit()) return false
      if (!suggestMode) return removeLinkCommand(state, view.dispatch)
      const range = linkRange(state)
      if (!range) return false
      suggest(() => suggestLink(state, range, null, suggestionOptions()))
      return true
    },
    setHeading: (level: HeadingLevel) =>
      canEdit() &&
      (suggestMode
        ? runHeading(level)
        : setHeadingCommand(level)(state, view.dispatch)),
    toggleTask: () => canEdit() && toggleTaskChecked(state, view.dispatch),
    insertBlock: (kind: InsertableBlock) =>
      canEdit() && insertBlockCommand(kind)(state, view.dispatch),
    focus: () => view.focus(),
    /** Puts the caret at the very start of the text and focuses the editor. */
    focusStart: () => {
      view.dispatch(state.tr.setSelection(Selection.atStart(state.doc)))
      view.focus()
    },
    focusBlock: focusBlockAt,
    selectAll: selectAllContent,
    undo: () => canEdit() && undoYjs(state),
    redo: () => canEdit() && redoYjs(state),
    resolveSelection: (selection: DocumentBodySelection) => {
      const anchor = resolveRelative(state, selection.anchor)
      const head = resolveRelative(state, selection.head)
      return anchor === null || head === null ? null : { anchor, head }
    },
    setRemoteCursors: (cursors: RemoteCursor[]) => {
      remoteCursors = cursors
      view.dispatch(view.state.tr.setMeta(remoteCursorPlugin, 'refresh'))
    },
    setSuggestMode: (next: boolean) => {
      if (suggestMode !== next) continueSuggestion = false
      suggestMode = next
    },
    getSuggestionCards: () => suggestionCards(state.doc),
    scrollToSuggestion: (id: string) => {
      const target = [
        ...view.dom.querySelectorAll<HTMLElement>('[data-suggestion-id]'),
      ].find((element) => element.dataset.suggestionId === id)
      if (!target) return false
      view.dispatch(view.state.tr.setMeta(suggestionFocusKey, id))
      const currentTarget = [
        ...view.dom.querySelectorAll<HTMLElement>('[data-suggestion-id]'),
      ].find((element) => element.dataset.suggestionId === id)
      currentTarget?.scrollIntoView({ block: 'center' })
      return true
    },
    /**
     * Accepts or rejects one suggestion as an ordinary edit. Canonical runs and
     * blocks it removes entirely are sent as a structural delete; their node
     * IDs are returned.
     */
    decide: (id: string, decision: 'accept' | 'reject') => {
      continueSuggestion = false
      try {
        const { transaction, structuralDeletes } = decideSuggestion(
          state,
          id,
          decision
        )
        if (transaction.docChanged)
          view.dispatch(transaction.setMeta(trackedMeta, true))
        if (structuralDeletes.length) queueDeleteNode(structuralDeletes)
        return structuralDeletes
      } catch (error) {
        if (error instanceof UnsupportedSuggestionError)
          options.onSuggestRefused?.(error.message)
        else throw error
        return []
      }
    },
    setReadOnly: (next: boolean) => {
      const changed = readOnly !== next
      readOnly = next
      if (changed)
        view.setProps({
          editable: () => !readOnly,
        })
      if (!next) ensureEmptyParagraph()
    },
    destroy: () => {
      undoManager?.off('stack-item-added', publishHistory)
      undoManager?.off('stack-item-popped', publishHistory)
      undoManager?.off('stack-cleared', publishHistory)
      pageEnd.remove()
      view.destroy()
    },
  }
}

/** Bind each shortcut to both Ctrl and Cmd so it works on every platform. */
function bindControlAndMeta<T>(bindings: Record<string, T>) {
  const bound: Record<string, T> = {}
  for (const [key, command] of Object.entries(bindings)) {
    const parts = key.split('-')
    const last = parts.pop()!
    for (const modifier of ['Ctrl', 'Meta'])
      bound[[modifier, ...parts, last].join('-')] = command
  }
  return bound
}

function blockNodeIDAt(doc: EditorState['doc'], position: number) {
  const resolved = doc.resolve(position)
  for (let depth = resolved.depth; depth > 0; depth--) {
    const node = resolved.node(depth)
    if (node.isBlock && typeof node.attrs.nodeID === 'string')
      return node.attrs.nodeID as string
  }
  throw new Error('comment anchor is outside a stable block')
}

function fullySelectedBlockNodeID(selection: EditorState['selection']) {
  if (selection.empty) return null
  const { $from, $to } = selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    const nodeID = node.attrs.nodeID
    if (
      node.isBlock &&
      node.type.name !== 'document' &&
      typeof nodeID === 'string' &&
      $to.depth >= depth &&
      $to.node(depth) === node &&
      selection.from === $from.start(depth) &&
      selection.to === $from.end(depth)
    )
      return nodeID
  }
  return null
}
