import type { JSONOpList } from 'ot-json1'
import * as json1 from 'ot-json1'
import type { Muya } from '../muya'
import {
  type IAnchorFocusInfo,
  type IHistorySelection,
  SelectionCaretType,
  SelectionDirection,
} from '../selection/types'
import { asDoc } from '../state'
import type { TState } from '../state/types'
import type { Nullable } from '../types'
import { deepClone } from '../utils'

interface IOptions {
  delay: number
  maxStack: number
  userOnly: boolean
}

interface IOperation {
  operation: JSONOpList
  selection: Nullable<IHistorySelection>
  // A `rebuild` entry is applied on undo/redo by dispatching its op to the
  // authoritative json state and rebuilding the live block tree wholesale
  // (ScrollPage.updateState) — NOT through `Editor.updateContents`'
  // incremental pick/drop DOM walker. The walker only handles a few op shapes
  // (single block insert at an index, text edit, checked/meta) and desyncs the
  // DOM from the json state for whole-document ops, so bulk replacements
  // (e.g. exiting source-code mode) are recorded as rebuild entries. The op
  // itself is a normal, fully-invertible ot-json1 op, so compose / transform /
  // invert continue to work unchanged.
  rebuild?: boolean
}

interface IStack {
  undo: IOperation[]
  redo: IOperation[]
}

// A JSON-serializable view of an ISelection. The live endpoint `block`
// references are dropped — they are an in-memory optimization only.
// `Selection._setCursor` re-resolves the target block from each endpoint's
// `path` via `scrollPage.queryBlock(path)` when no block instance is present,
// so a path-only selection restores the caret losslessly.
type ISerializableAnchorFocusInfo = Pick<IAnchorFocusInfo, 'offset' | 'path'>

interface ISerializableSelection {
  anchor: ISerializableAnchorFocusInfo
  focus: ISerializableAnchorFocusInfo
  isCollapsed: IHistorySelection['isCollapsed']
  isSelectionInSameBlock: IHistorySelection['isSelectionInSameBlock']
  direction: IHistorySelection['direction']
  type: IHistorySelection['type']
}

interface ISerializableOperation {
  operation: JSONOpList
  selection: Nullable<ISerializableSelection>
  rebuild?: boolean
}

// The public, JSON-serializable shape returned by `getHistory` and accepted by
// `setHistory`. Mirrors the private `_stack` plus the bookkeeping pointers
// (`lastRecorded`, `selectionStack`) needed to round-trip the recording state.
export interface ISerializedHistory {
  stack: {
    undo: ISerializableOperation[]
    redo: ISerializableOperation[]
  }
  lastRecorded: number
  selectionStack?: Nullable<ISerializableSelection>[]
  lastSelection?: Nullable<ISerializableSelection>
}

enum HistoryAction {
  UNDO = 'undo',
  REDO = 'redo',
}

const DEFAULT_OPTIONS = {
  delay: 1000,
  maxStack: 100,
  userOnly: false,
}

export type TInputKind = 'insert' | 'delete'

export function classifyInputKind(inputType: string): Nullable<TInputKind> {
  if (inputType.startsWith('insert')) return 'insert'
  if (inputType.startsWith('delete')) return 'delete'
  return null
}

export function shouldBreakUndoGroup(
  prevKind: Nullable<TInputKind>,
  kind: Nullable<TInputKind>,
  data: Nullable<string>
): boolean {
  if (kind == null) return false
  const isWordBoundary = kind === 'insert' && data != null && /\s/.test(data)
  const switchedKind = prevKind != null && prevKind !== kind
  return isWordBoundary || switchedKind
}

export function extractSelectionFromOp(
  op: Nullable<JSONOpList>
): Nullable<IHistorySelection> {
  if (!op || !Array.isArray(op) || op.length === 0) return null

  const path: (string | number)[] = []
  let current: unknown = op

  while (Array.isArray(current)) {
    if (current.length === 0) break

    const last = current[current.length - 1]
    if (typeof last === 'object' && last !== null && !Array.isArray(last)) {
      for (let i = 0; i < current.length - 1; i++) {
        if (typeof current[i] === 'string' || typeof current[i] === 'number')
          path.push(current[i] as string | number)
      }

      const leaf = last as Record<string, unknown>
      if (leaf.es && Array.isArray(leaf.es)) {
        let offset = 0
        const es = leaf.es
        let idx = 0
        if (typeof es[0] === 'number') {
          offset = es[0]
          idx = 1
        }

        let targetOffset = offset

        for (let i = idx; i < es.length; i++) {
          const item = es[i]
          if (typeof item === 'string') {
            targetOffset += item.length
          } else if (typeof item === 'number') {
            targetOffset += item
          }
        }

        const blockPath = path.filter((seg) => seg !== 'children')
        const targetPath =
          blockPath[blockPath.length - 1] === 'text'
            ? blockPath
            : [...blockPath, 'text']

        return {
          anchor: { offset: targetOffset, path: targetPath },
          focus: { offset: targetOffset, path: targetPath },
          isCollapsed: true,
          isSelectionInSameBlock: true,
          direction: SelectionDirection.NONE,
          type: SelectionCaretType.CARET,
        }
      }
      break
    } else if (
      typeof current[0] === 'string' ||
      typeof current[0] === 'number'
    ) {
      path.push(current[0])
      current = current[1]
    } else {
      break
    }
  }

  return null
}

class History {
  private _lastRecorded: number = 0
  private _lastInputKind: Nullable<TInputKind> = null
  private _ignoreChange: boolean = false
  private _lastSelection: Nullable<IHistorySelection> = null
  private _stack: IStack = {
    undo: [],
    redo: [],
  }

  private get _selection() {
    return this._muya.editor.selection
  }

  constructor(
    private _muya: Muya,
    private _options: IOptions = DEFAULT_OPTIONS
  ) {
    this._listen()
  }

  private _listen() {
    this._muya.eventCenter.on('selection-change', () => {
      if (this._ignoreChange) return
      const current = this._selection.getSelection()
      if (current) {
        if (
          this._lastSelection &&
          (this._lastSelection.anchor.block !== current.anchor.block ||
            Math.abs(
              this._lastSelection.anchor.offset - current.anchor.offset
            ) > 1)
        ) {
          this.cutoff()
        }
        this._lastSelection = current
      }
    })

    this._muya.eventCenter.on(
      'json-change',
      ({
        op,
        source,
        prevDoc,
      }: {
        op: Nullable<JSONOpList>
        source: string
        prevDoc: TState[]
        doc: TState[]
      }) => {
        if (this._ignoreChange) return

        if (op == null) return

        if (!this._options.userOnly || source === 'user')
          this._record(op, prevDoc)
        else this._transform(op)
      }
    )
  }

  private _emitHistoryChange() {
    this._muya.eventCenter.emit('history-change', {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    })
  }

  private _change(source: HistoryAction, dest: HistoryAction) {
    if (this._stack[source].length === 0) return

    const {
      operation,
      selection: storedSelection,
      rebuild,
    } = this._stack[source].pop()!
    const selection = extractSelectionFromOp(operation) ?? storedSelection
    const inverseOperation = json1.type.invertWithDoc(
      operation,
      asDoc(this._muya.editor.jsonState.getState())
    )

    const currentSel = this._selection.getSelection()
    const collapsedSel = currentSel
      ? {
          ...currentSel,
          anchor: {
            ...currentSel.anchor,
            offset: Math.max(currentSel.anchor.offset, currentSel.focus.offset),
          },
          focus: {
            ...currentSel.focus,
            offset: Math.max(currentSel.anchor.offset, currentSel.focus.offset),
          },
          isCollapsed: true,
          type: SelectionCaretType.CARET,
        }
      : null

    this._stack[dest].push({
      operation: inverseOperation as JSONOpList,
      selection: collapsedSel,
      rebuild,
    })

    this._lastRecorded = 0
    this._ignoreChange = true
    try {
      if (rebuild)
        this._muya.editor.rebuildContents(operation, selection, 'user')
      else this._muya.editor.updateContents(operation, selection, 'user')
    } finally {
      this._ignoreChange = false
    }

    this._lastSelection = this._selection.getSelection()
    this._emitHistoryChange()
  }

  clear() {
    this._stack = { undo: [], redo: [] }
    this._lastSelection = null
    this._lastRecorded = 0
    this._ignoreChange = false
    this._emitHistoryChange()
  }

  getHistory(): ISerializedHistory {
    return {
      stack: {
        undo: this._stack.undo.map((op) => this._toSerializableOperation(op)),
        redo: this._stack.redo.map((op) => this._toSerializableOperation(op)),
      },
      lastRecorded: this._lastRecorded,
      selectionStack: this._lastSelection
        ? [this._toSerializableSelection(this._lastSelection)]
        : [],
      lastSelection: this._toSerializableSelection(this._lastSelection),
    }
  }

  setHistory(history: ISerializedHistory) {
    this._stack = {
      undo: history.stack.undo.map((op) => this._fromSerializableOperation(op)),
      redo: history.stack.redo.map((op) => this._fromSerializableOperation(op)),
    }
    this._lastRecorded = history.lastRecorded ?? 0
    this._lastSelection = this._fromSerializableSelection(
      history.lastSelection ??
        (history.selectionStack && history.selectionStack.length > 0
          ? history.selectionStack[0]
          : null)
    )
    this._emitHistoryChange()
  }

  private _toSerializableOperation(op: IOperation): ISerializableOperation {
    return {
      operation: deepClone(op.operation),
      selection: this._toSerializableSelection(op.selection),
      ...(op.rebuild ? { rebuild: true } : {}),
    }
  }

  private _fromSerializableOperation(op: ISerializableOperation): IOperation {
    return {
      operation: deepClone(op.operation),
      selection: this._fromSerializableSelection(op.selection),
      ...(op.rebuild ? { rebuild: true } : {}),
    }
  }

  private _toSerializableSelection(
    selection: Nullable<IHistorySelection>
  ): Nullable<ISerializableSelection> {
    if (selection == null) return selection

    return {
      anchor: {
        offset: selection.anchor.offset,
        path: deepClone(selection.anchor.path),
      },
      focus: {
        offset: selection.focus.offset,
        path: deepClone(selection.focus.path),
      },
      isCollapsed: selection.isCollapsed,
      isSelectionInSameBlock: selection.isSelectionInSameBlock,
      direction: selection.direction,
      type: selection.type,
    }
  }

  private _fromSerializableSelection(
    selection: Nullable<ISerializableSelection>
  ): Nullable<IHistorySelection> {
    if (selection == null) return selection

    return {
      anchor: {
        offset: selection.anchor.offset,
        path: deepClone(selection.anchor.path),
      },
      focus: {
        offset: selection.focus.offset,
        path: deepClone(selection.focus.path),
      },
      isCollapsed: selection.isCollapsed,
      isSelectionInSameBlock: selection.isSelectionInSameBlock,
      direction: selection.direction,
      type: selection.type,
    }
  }

  cutoff() {
    this._lastRecorded = 0
    this._lastSelection = this._selection.getSelection()
  }

  markInputBoundary(inputType: string, data: Nullable<string>): void {
    const kind = classifyInputKind(inputType)
    if (kind == null) return
    if (shouldBreakUndoGroup(this._lastInputKind, kind, data)) this.cutoff()
    this._lastInputKind = kind
  }

  private _record(op: JSONOpList, doc: TState[]) {
    if (op.length === 0) return

    let undoOperation = json1.type.invertWithDoc(op, asDoc(doc))
    this._stack.redo = []

    let selection =
      extractSelectionFromOp(undoOperation) ??
      this._lastSelection ??
      this._selection.getSelection()

    const timestamp = Date.now()
    if (
      this._lastRecorded + this._options.delay > timestamp &&
      this._stack.undo.length > 0
    ) {
      const { operation: lastOperation, selection: lastSelection } =
        this._stack.undo.pop()!
      undoOperation = json1.type.compose(undoOperation, lastOperation)
      selection =
        extractSelectionFromOp(undoOperation) ?? lastSelection ?? selection
    } else {
      this._lastRecorded = timestamp
    }

    if (!undoOperation || undoOperation.length === 0) return

    this._stack.undo.push({ operation: undoOperation, selection })

    if (this._stack.undo.length > this._options.maxStack)
      this._stack.undo.shift()

    this._lastSelection = this._selection.getSelection()
    this._emitHistoryChange()
  }

  /**
   * Record a whole-document replacement (e.g. exiting source-code mode) as a
   * single, standalone undo boundary that is applied via a full block-tree
   * rebuild rather than the incremental DOM walker.
   *
   * The forward op (`prevDoc` -> current state) is dispatched to the json
   * state by the caller; here we only record its lossless inverse so the first
   * undo reverts the entire bulk change in one step. The entry never coalesces
   * with neighbouring edits: `_lastRecorded` is reset so the next ordinary
   * edit also starts its own boundary, and the redo stack is cleared.
   */
  recordRebuild(
    op: JSONOpList,
    prevDoc: TState[],
    selection: Nullable<IHistorySelection>
  ) {
    if (op.length === 0) return

    const undoOperation = json1.type.invertWithDoc(op, asDoc(prevDoc))

    if (!undoOperation || undoOperation.length === 0) return

    this._stack.redo = []
    this._stack.undo.push({
      operation: undoOperation,
      selection,
      rebuild: true,
    })
    // Force the next ordinary edit into its own undo entry — the bulk
    // replacement must not absorb a later keystroke (or vice versa).
    this._lastRecorded = 0

    if (this._stack.undo.length > this._options.maxStack)
      this._stack.undo.shift()

    this._emitHistoryChange()
  }

  /**
   * Run `fn` (which dispatches a json-change) WITHOUT recording it on the undo
   * stack. The caller has already recorded the corresponding boundary itself
   * (see `recordRebuild`), so the forward apply must not be double-recorded.
   */
  suppressRecording(fn: () => void) {
    const previous = this._ignoreChange
    this._ignoreChange = true
    try {
      fn()
    } finally {
      this._ignoreChange = previous
    }
  }

  canRedo() {
    return this._stack.redo.length > 0
  }

  redo() {
    this._change(HistoryAction.REDO, HistoryAction.UNDO)
  }

  private _transform(op: JSONOpList) {
    transformStack(this._stack.undo, op)
    transformStack(this._stack.redo, op)
  }

  canUndo() {
    return this._stack.undo.length > 0
  }

  undo() {
    this._change(HistoryAction.UNDO, HistoryAction.REDO)
  }
}

function transformStack(stack: IOperation[], operation: JSONOpList) {
  let remoteOperation = operation

  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const { operation: oldOperation } = stack[i]
    // TODO: need test.
    stack[i] = Object.assign(stack[i], {
      operation: json1.type.transform(oldOperation, remoteOperation, 'left'),
    })
    remoteOperation = json1.type.transform(
      remoteOperation,
      oldOperation,
      'right'
    )!
    if (stack[i].operation.length === 0) stack.splice(i, 1)
  }
}

export default History
