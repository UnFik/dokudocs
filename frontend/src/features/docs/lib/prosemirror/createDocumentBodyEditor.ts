import { inputRules } from 'prosemirror-inputrules'
import { keymap } from 'prosemirror-keymap'
import {
  AllSelection,
  EditorState,
  NodeSelection,
  Plugin,
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
import type { RemoteCursor } from '../collaboration-socket'
import type { DocumentBodyNode } from '../documentBody'
import {
  translateTextEdit,
  typingRefusal,
  type TextEditTranslation,
} from '../suggestion-operations'
import {
  headingInputRule,
  insertBlockCommand,
  setHeadingCommand,
  splitTextBlock,
  toggleTaskChecked,
  type InsertableBlock,
} from './blockCommands'
import { documentBodySchema, prosemirrorToDocumentBody } from './documentBody'
import {
  emptyInlineState,
  readInlineState,
  removeLinkCommand,
  setLinkCommand,
  toggleInlineMark,
  type InlineMarkName,
  type InlineState,
} from './inlineMarks'
import {
  DeleteNodeRequiredError,
  MoveNodeRequiredError,
  prepareBodyTransaction,
} from './prepareBodyTransaction'
import { planSelectionDeletion, textblockAt } from './selectionDeletion'

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
    plugins?: Plugin[]
    nodeViews?: EditorProps['nodeViews']
    onEditorReady?: (view: EditorView) => void
    onBodyChange?: (body: DocumentBodyNode[]) => void
    onDeleteNode?: (nodeIDs: string[]) => void | Promise<void>
    onDeleteNodeQueued?: (nodeID: string) => void
    onMoveNode?: (move: MoveNodeIntent) => void | Promise<void>
    onMoveNodeQueued?: (move: MoveNodeIntent) => void
    onTransactionError?: (error: unknown) => void
    onHistoryChange?: (history: EditorHistoryState) => void
    onInlineStateChange?: (state: InlineState) => void
    onLinkRequest?: () => void
    /** Suggest mode: a local edit is reported here instead of being applied. */
    onSuggestTransaction?: (result: TextEditTranslation) => void
    /** Fires when the local selection moves; null when the editor loses focus. */
    onSelectionChange?: (selection: DocumentBodySelection | null) => void
  } = {}
) {
  const fragment = ydoc.getXmlFragment('body')
  let readOnly = options.readOnly ?? false
  let suggestMode = false
  let structuralCommandPending = false
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
      // Block plugins (slash menu, drag handle) run before the keymaps below so
      // they can claim Enter and arrow keys while a menu is open.
      ...(options.plugins ?? []),
      inputRules({ rules: [headingInputRule] }),
      keymap({
        Enter: () => runBlock(splitTextBlock),
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
              () => runBlock(setHeadingCommand(level)),
            ])
          )
        ),
      }),
      keymap(
        bindControlAndMeta({
          b: () => runInline(toggleInlineMark('strong')),
          i: () => runInline(toggleInlineMark('em')),
          e: () => runInline(toggleInlineMark('code')),
          'Shift-x': () => runInline(toggleInlineMark('strike')),
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
  const canEdit = () => !readOnly && !structuralCommandPending
  // Select all stays inside the document body. In read-only mode there is no
  // caret, so the selection is set on the DOM instead.
  const selectAllContent = () => {
    const view = viewHolder.current
    if (!view) return
    if (readOnly || structuralCommandPending) {
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
    if (canEdit() && !suggestMode) action(state)
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
  const queueDeleteNode = (nodeIDs: string[]) => {
    if (!options.onDeleteNode) return false
    structuralCommandPending = true
    viewHolder.current?.setProps({ editable: () => false })
    void Promise.resolve()
      .then(() => options.onDeleteNode!(nodeIDs))
      .then(() => options.onDeleteNodeQueued?.(nodeIDs[0]!))
      .catch((cause: unknown) => options.onTransactionError?.(cause))
    return true
  }

  // Delete with a selection that is not inside one textblock (select all, a
  // separator, text across blocks). The browser's own deletion is ignored by the
  // editor for these, so it is done here: whole blocks and runs go through
  // DeleteNode as one batch, and text left at the ends is trimmed as an edit.
  const deleteAcrossBlocks = () => {
    const { selection } = state
    if (selection.empty) return false
    const first = textblockAt(state.doc, selection.from)
    if (
      !(selection instanceof NodeSelection) &&
      first &&
      first === textblockAt(state.doc, selection.to)
    )
      return false
    const plan = planSelectionDeletion(state.doc, selection.from, selection.to)
    if (!plan.ok) {
      options.onTransactionError?.(new Error(plan.message))
      return true
    }
    if (plan.trims.length) {
      let trim = state.tr
      for (const range of [...plan.trims].reverse())
        trim = trim.delete(range.from, range.to)
      viewHolder.current?.dispatch(trim)
    }
    if (plan.roots.length) queueDeleteNode(plan.roots)
    return true
  }

  const dispatchTransaction = (transaction: Transaction) => {
    const remote = transaction.getMeta(ySyncPluginKey)?.isChangeOrigin === true
    let prepared = transaction

    try {
      if (structuralCommandPending && transaction.docChanged && !remote) return
      if (readOnly && transaction.docChanged && !remote) return
      if (suggestMode && transaction.docChanged && !remote) {
        let translation: TextEditTranslation
        try {
          translation = translateTextEdit(
            prosemirrorToDocumentBody(state.doc),
            prosemirrorToDocumentBody(transaction.doc)
          )
        } catch {
          translation = { ok: false, message: typingRefusal }
        }
        options.onSuggestTransaction?.(translation)
        viewHolder.current?.updateState(state)
        return
      }
      if (transaction.docChanged && !remote) {
        if (wouldRemoveInlineRun(state.doc, transaction.doc)) {
          viewHolder.current?.updateState(state)
          return
        }
        prepared = prepareBodyTransaction(state, transaction)
        const afterIDs = new Set(
          prosemirrorToDocumentBody(prepared.doc).map((node) => node.nodeID)
        )
        if (
          prosemirrorToDocumentBody(state.doc).some(
            (node) => !afterIDs.has(node.nodeID)
          )
        )
          throw new Error('structural deletion requires a DeleteNode command')
      }
      const result = state.applyTransaction(prepared)
      state = result.state
      viewHolder.current?.updateState(state)
      if (result.transactions.some((item) => item.docChanged))
        options.onBodyChange?.(prosemirrorToDocumentBody(state.doc))
      publishInline()
      if (
        options.onSelectionChange &&
        !remote &&
        (transaction.selectionSet || transaction.docChanged)
      ) {
        const selection = toRelativeSelection(state)
        if (selection) options.onSelectionChange(selection)
      }
    } catch (error) {
      if (
        error instanceof DeleteNodeRequiredError &&
        queueDeleteNode(error.nodeIDs)
      )
        return
      if (error instanceof MoveNodeRequiredError && options.onMoveNode) {
        const move = {
          nodeID: error.nodeID,
          targetParentID: error.targetParentID,
          beforeNodeID: error.beforeNodeID,
        }
        structuralCommandPending = true
        viewHolder.current?.setProps({ editable: () => false })
        void Promise.resolve()
          .then(() => options.onMoveNode!(move))
          .then(() => options.onMoveNodeQueued?.(move))
          .catch((cause: unknown) => options.onTransactionError?.(cause))
        return
      }
      options.onTransactionError?.(error)
    }
  }

  const view = new EditorView(mount, {
    state,
    nodeViews: options.nodeViews,
    dispatchTransaction,
    editable: () => !readOnly && !structuralCommandPending,
    handleDOMEvents: {
      blur: () => {
        options.onSelectionChange?.(null)
        return false
      },
    },
    handleKeyDown: (editorView, event) => {
      // Keys pressed during IME composition belong to the input method.
      if (readOnly || structuralCommandPending || event.isComposing)
        return false
      // Block deletion and moves are queued commands on the canonical body;
      // in suggest mode they must go through the suggestions panel instead.
      if (suggestMode) return false
      if (
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        (event.key === 'Backspace' || event.key === 'Delete')
      ) {
        const nodeID = fullySelectedBlockNodeID(editorView.state.selection)
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
        deleteAcrossBlocks()
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
  // Deleting every block leaves an empty body; give the user a line to type on.
  const ensureEmptyParagraph = () => {
    const body = state.doc.firstChild
    if (!canEdit() || suggestMode || body?.childCount !== 0) return
    view.dispatch(
      state.tr.insert(1, documentBodySchema.nodes.paragraph!.create())
    )
  }
  options.onEditorReady?.(view)
  if (view.state !== state) view.updateState(state)
  const undoManager = yUndoPluginKey.getState(state)?.undoManager
  undoManager?.on('stack-item-added', publishHistory)
  undoManager?.on('stack-item-popped', publishHistory)
  undoManager?.on('stack-cleared', publishHistory)
  ensureEmptyParagraph()

  return {
    view,
    ydoc,
    getBody: () => prosemirrorToDocumentBody(state.doc),
    createAnchor: (from: number, to: number): DocumentBodyAnchor => {
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
    },
    resolveAnchor: (anchor: DocumentBodyAnchor) => {
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
    },
    getHistory: readHistory,
    getInlineState: () => readInlineState(view),
    toggleMark: (name: InlineMarkName) =>
      canEdit() && toggleInlineMark(name)(state, view.dispatch),
    setLink: (href: string) =>
      canEdit() && setLinkCommand(href)(state, view.dispatch),
    removeLink: () => canEdit() && removeLinkCommand(state, view.dispatch),
    setHeading: (level: 0 | 1 | 2 | 3 | 4 | 5 | 6) =>
      canEdit() && setHeadingCommand(level)(state, view.dispatch),
    toggleTask: () => canEdit() && toggleTaskChecked(state, view.dispatch),
    insertBlock: (kind: InsertableBlock) =>
      canEdit() && insertBlockCommand(kind)(state, view.dispatch),
    focus: () => view.focus(),
    selectAll: selectAllContent,
    undo: () => canEdit() && !suggestMode && undoYjs(state),
    redo: () => canEdit() && !suggestMode && redoYjs(state),
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
      suggestMode = next
    },
    setReadOnly: (next: boolean) => {
      readOnly = next
      view.setProps({ editable: () => !readOnly && !structuralCommandPending })
      if (!next) ensureEmptyParagraph()
    },
    destroy: () => {
      undoManager?.off('stack-item-added', publishHistory)
      undoManager?.off('stack-item-popped', publishHistory)
      undoManager?.off('stack-cleared', publishHistory)
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

function wouldRemoveInlineRun(
  beforeDoc: EditorState['doc'],
  afterDoc: EditorState['doc']
) {
  const indexNodes = (doc: EditorState['doc']) => {
    const ids = new Set<string>()
    const runs = new Map<string, { parentID: string | null; text: string }>()
    const visit = (node: EditorState['doc'], parentID: string | null) => {
      const nodeID =
        typeof node.attrs.nodeID === 'string' ? node.attrs.nodeID : null
      if (nodeID) ids.add(nodeID)
      if (node.type.name === 'run' && nodeID)
        runs.set(nodeID, { parentID, text: node.textContent })
      for (let index = 0; index < node.childCount; index++)
        visit(node.child(index), nodeID ?? parentID)
    }
    visit(doc, null)
    return { ids, runs }
  }

  const before = indexNodes(beforeDoc)
  const after = indexNodes(afterDoc)
  return [...before.runs].some(([nodeID, run]) => {
    const next = after.runs.get(nodeID)
    return (
      run.text.length > 0 &&
      (!next || next.text.length === 0) &&
      run.parentID !== null &&
      after.ids.has(run.parentID)
    )
  })
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
