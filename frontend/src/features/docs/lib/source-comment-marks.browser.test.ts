import * as monaco from 'monaco-editor'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { setupMonaco } from './monaco-setup'
import { trackSourceComments } from './source-comment-marks'
import { createSourceAnchor } from './source-comments'

setupMonaco()

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function setup(source: string) {
  const doc = new Y.Doc()
  const text = doc.getText('source')
  text.insert(0, source)
  const host = document.createElement('div')
  host.style.cssText = 'width:600px;height:300px'
  document.body.append(host)
  const editor = monaco.editor.create(host, { language: 'dbml', value: source })
  editor.getModel()!.setEOL(monaco.editor.EndOfLineSequence.LF)
  const onRanges = vi.fn()
  const marks = trackSourceComments({ editor, text, onRanges })
  cleanups.push(() => {
    marks.destroy()
    editor.dispose()
    host.remove()
  })
  // The editor follows the shared text through the binding in the app; here by hand.
  const write = (index: number, value: string) => {
    text.insert(index, value)
    editor.getModel()!.setValue(text.toString())
  }
  const decorated = (className: string) =>
    editor
      .getModel()!
      .getAllDecorations()
      .filter((item) => item.options.inlineClassName === className)
      .map((item) => editor.getModel()!.getValueInRange(item.range))
  return { doc, text, editor, marks, onRanges, write, decorated }
}

const anchor = (text: Y.Text, from: number, to: number) =>
  createSourceAnchor(text, from, to)!

describe('trackSourceComments', () => {
  it('marks the words of each open thread and reports where they are', () => {
    const { text, marks, onRanges, decorated } = setup(
      'Table users {\n  id int\n}'
    )
    marks.setThreads([
      { id: 'a', anchor: anchor(text, 6, 11), resolved: false },
      { id: 'b', anchor: anchor(text, 16, 18), resolved: false },
    ])
    expect(decorated('source-comment-mark').sort()).toEqual(['id', 'users'])
    const last = onRanges.mock.calls.at(-1)![0] as Map<string, unknown>
    expect(last.get('a')).toEqual({ from: 6, to: 11 })
    expect(last.get('b')).toEqual({ from: 16, to: 18 })
  })

  it('leaves a resolved thread unmarked, and the thread reports no range', () => {
    const { text, marks, onRanges, decorated } = setup('hello world')
    marks.setThreads([{ id: 'a', anchor: anchor(text, 0, 5), resolved: true }])
    expect(decorated('source-comment-mark')).toEqual([])
    expect(
      (onRanges.mock.calls.at(-1)![0] as Map<string, unknown>).has('a')
    ).toBe(false)
  })

  it('moves the marks when the text changes, and drops one whose words are deleted', () => {
    const { text, marks, onRanges, write, decorated } = setup('hello world')
    marks.setThreads([
      { id: 'a', anchor: anchor(text, 6, 11), resolved: false },
    ])
    write(0, 'oh, ')
    marks.refresh()
    expect(decorated('source-comment-mark')).toEqual(['world'])
    expect(
      (onRanges.mock.calls.at(-1)![0] as Map<string, unknown>).get('a')
    ).toEqual({ from: 10, to: 15 })

    text.delete(10, 5)
    marks.refresh()
    expect(decorated('source-comment-mark')).toEqual([])
    expect(
      (onRanges.mock.calls.at(-1)![0] as Map<string, unknown>).get('a')
    ).toBeNull()
  })

  it('shows the focused thread differently', () => {
    const { text, marks, decorated } = setup('hello world')
    marks.setThreads([
      { id: 'a', anchor: anchor(text, 0, 5), resolved: false },
      { id: 'b', anchor: anchor(text, 6, 11), resolved: false },
    ])
    marks.setFocused('b')
    expect(decorated('source-comment-focus')).toEqual(['world'])
    expect(decorated('source-comment-mark')).toEqual(['hello'])
    marks.setFocused(null)
    expect(decorated('source-comment-focus')).toEqual([])
  })

  it('finds the thread under a position, the innermost when marks overlap', () => {
    const { text, marks } = setup('hello world tail')
    marks.setThreads([
      { id: 'wide', anchor: anchor(text, 0, 11), resolved: false },
      { id: 'narrow', anchor: anchor(text, 6, 11), resolved: false },
    ])
    expect(marks.threadAt({ lineNumber: 1, column: 8 })).toBe('narrow')
    expect(marks.threadAt({ lineNumber: 1, column: 2 })).toBe('wide')
    expect(marks.threadAt({ lineNumber: 1, column: 14 })).toBeNull()
  })

  it('selects and reveals the words of a thread', () => {
    const { text, marks, editor } = setup('hello world')
    marks.setThreads([
      { id: 'a', anchor: anchor(text, 6, 11), resolved: false },
    ])
    expect(marks.reveal('a')).toBe(true)
    const selection = editor.getSelection()!
    expect(editor.getModel()!.getValueInRange(selection)).toBe('world')
    expect(marks.reveal('missing')).toBe(false)
  })

  it('anchors the current selection, and nothing when there is none', () => {
    const { text, marks, editor } = setup('hello world')
    expect(marks.anchorSelection()).toBeNull()
    editor.setSelection(new monaco.Selection(1, 7, 1, 12))
    const picked = marks.anchorSelection()!
    expect(picked.selectedText).toBe('world')
    expect(picked.anchor).toEqual(anchor(text, 6, 11))
  })
})
