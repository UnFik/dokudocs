import * as monaco from 'monaco-editor'
import type * as Y from 'yjs'
import {
  createSourceAnchor,
  resolveSourceAnchor,
  type SourceAnchor,
} from './source-comments'

export type SourceThread = {
  id: string
  anchor: SourceAnchor
  resolved: boolean
}

/** Where a thread's words are in the source now; null once they are gone. */
export type SourceRanges = Map<string, { from: number; to: number } | null>

const MAX_SELECTED_TEXT = 500

/**
 * Marks the words of each open comment thread in a Monaco editor bound to the
 * shared source, and keeps the marks on the words as the text changes. A
 * resolved thread has no marks and is not reported.
 */
export function trackSourceComments(input: {
  editor: monaco.editor.IStandaloneCodeEditor
  text: Y.Text
  /** Called whenever the ranges may have changed, with every open thread. */
  onRanges: (ranges: SourceRanges) => void
}) {
  const { editor, text } = input
  const doc = text.doc!
  const collection = editor.createDecorationsCollection()
  let threads: SourceThread[] = []
  let focused: string | null = null
  let ranges: SourceRanges = new Map()
  let frame = 0
  let alive = true

  const refresh = () => {
    cancelAnimationFrame(frame)
    const model = editor.getModel()
    if (!alive || !model) return
    const next: SourceRanges = new Map()
    const decorations: monaco.editor.IModelDeltaDecoration[] = []
    for (const thread of threads) {
      if (thread.resolved) continue
      const found = resolveSourceAnchor(doc, text, thread.anchor)
      next.set(thread.id, found)
      if (!found) continue
      const start = model.getPositionAt(found.from)
      const end = model.getPositionAt(found.to)
      decorations.push({
        range: new monaco.Range(
          start.lineNumber,
          start.column,
          end.lineNumber,
          end.column
        ),
        options: {
          inlineClassName:
            thread.id === focused
              ? 'source-comment-focus'
              : 'source-comment-mark',
          stickiness:
            monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      })
    }
    collection.set(decorations)
    ranges = next
    input.onRanges(next)
  }
  const schedule = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(refresh)
  }
  text.observe(schedule)

  return {
    setThreads(next: SourceThread[]) {
      threads = next
      refresh()
    },
    setFocused(id: string | null) {
      focused = id
      refresh()
    },
    /** Marks again from the text as it is now, without waiting for the next frame. */
    refresh,
    /** The thread whose words hold a position; of several, the shortest. */
    threadAt(position: { lineNumber: number; column: number }): string | null {
      const model = editor.getModel()
      if (!model) return null
      const offset = model.getOffsetAt(position)
      let found: { id: string; length: number } | null = null
      for (const [id, range] of ranges) {
        if (!range || offset < range.from || offset > range.to) continue
        const length = range.to - range.from
        if (!found || length < found.length) found = { id, length }
      }
      return found?.id ?? null
    },
    /** Selects the thread's words and scrolls them into view. */
    reveal(id: string): boolean {
      const model = editor.getModel()
      const range = ranges.get(id)
      if (!model || !range) return false
      const start = model.getPositionAt(range.from)
      const end = model.getPositionAt(range.to)
      const selection = new monaco.Selection(
        start.lineNumber,
        start.column,
        end.lineNumber,
        end.column
      )
      editor.setSelection(selection)
      editor.revealRangeInCenterIfOutsideViewport(selection)
      return true
    },
    /** What a new comment would be on: the words selected now, or null with none. */
    anchorSelection(): { anchor: SourceAnchor; selectedText: string } | null {
      const model = editor.getModel()
      const selection = editor.getSelection()
      if (!model || !selection || selection.isEmpty()) return null
      const from = model.getOffsetAt(selection.getStartPosition())
      const to = model.getOffsetAt(selection.getEndPosition())
      const anchor = createSourceAnchor(text, from, to)
      if (!anchor) return null
      return {
        anchor,
        selectedText: model
          .getValueInRange(selection)
          .slice(0, MAX_SELECTED_TEXT),
      }
    },
    destroy() {
      alive = false
      cancelAnimationFrame(frame)
      text.unobserve(schedule)
      collection.clear()
    },
  }
}

export type SourceCommentMarks = ReturnType<typeof trackSourceComments>
