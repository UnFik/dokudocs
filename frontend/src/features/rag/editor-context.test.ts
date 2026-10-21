import { describe, expect, it } from 'vitest'
import {
  MAX_EDITOR_DIAGNOSTICS,
  MAX_EDITOR_EXCERPT_CHARS,
  MAX_EDITOR_MESSAGE_CHARS,
  buildEditorContext,
  type EditorMarker,
} from './editor-context'

const ERROR = 8
const WARNING = 4
const INFO = 2
const HINT = 1

const marker = (
  line: number,
  message: string,
  severity = ERROR,
  extra: Partial<EditorMarker> = {}
): EditorMarker => ({
  startLineNumber: line,
  startColumn: 1,
  endLineNumber: line,
  endColumn: 5,
  message,
  severity,
  ...extra,
})

const lines = (count: number) =>
  Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n')

const build = (
  markers: EditorMarker[],
  source = lines(40),
  cursor = { line: 1, column: 1 }
) =>
  buildEditorContext({
    documentId: 'doc-1',
    kind: 'dbml',
    source,
    cursor,
    markers,
  })

describe('buildEditorContext', () => {
  it('reports an editor with no errors as an empty list around the cursor', () => {
    const context = build([], lines(40), { line: 20, column: 3 })
    expect(context.diagnostics).toEqual([])
    expect(context.cursor).toEqual({ line: 20, column: 3 })
    expect(context.excerpt.fromLine).toBe(10)
    expect(context.excerpt.toLine).toBe(30)
    expect(context.excerpt.text.split('\n')[0]).toBe('line 10')
  })

  it('names the editor kind and document it came from', () => {
    const context = build([])
    expect(context.documentId).toBe('doc-1')
    expect(context.kind).toBe('dbml')
  })

  it('keeps errors and warnings and drops info and hints', () => {
    const context = build([
      marker(3, 'bad', ERROR),
      marker(4, 'meh', WARNING),
      marker(5, 'fyi', INFO),
      marker(6, 'psst', HINT),
    ])
    expect(context.diagnostics.map((d) => [d.message, d.severity])).toEqual([
      ['bad', 'error'],
      ['meh', 'warning'],
    ])
  })

  it('puts the error under the cursor first, then errors before warnings, then by line', () => {
    const context = build(
      [
        marker(2, 'warning high', WARNING),
        marker(9, 'error low'),
        marker(5, 'error high'),
        marker(7, 'under cursor', WARNING, { startColumn: 2, endColumn: 9 }),
      ],
      lines(40),
      { line: 7, column: 4 }
    )
    expect(context.diagnostics.map((d) => d.message)).toEqual([
      'under cursor',
      'error high',
      'error low',
      'warning high',
    ])
  })

  it('maps a marker to a diagnostic with the same positions', () => {
    const context = build([
      marker(3, 'Invalid column definition or missing type', ERROR, {
        startColumn: 2,
        endLineNumber: 4,
        endColumn: 8,
      }),
    ])
    expect(context.diagnostics).toEqual([
      {
        line: 3,
        column: 2,
        endLine: 4,
        endColumn: 8,
        severity: 'error',
        message: 'Invalid column definition or missing type',
      },
    ])
  })

  it('keeps at most the first diagnostics and cuts a long message', () => {
    const many = Array.from({ length: MAX_EDITOR_DIAGNOSTICS + 5 }, (_, i) =>
      marker(i + 1, 'x'.repeat(MAX_EDITOR_MESSAGE_CHARS + 50))
    )
    const context = build(many)
    expect(context.diagnostics).toHaveLength(MAX_EDITOR_DIAGNOSTICS)
    expect(context.diagnostics[0].message).toHaveLength(
      MAX_EDITOR_MESSAGE_CHARS
    )
  })

  it('takes the excerpt around the first diagnostic, ten lines each way', () => {
    const context = build([marker(25, 'bad')], lines(40), {
      line: 1,
      column: 1,
    })
    expect(context.excerpt.fromLine).toBe(15)
    expect(context.excerpt.toLine).toBe(35)
    expect(context.excerpt.text.split('\n')).toHaveLength(21)
  })

  it('does not run past the ends of the source', () => {
    const context = build([marker(2, 'bad')], lines(5))
    expect(context.excerpt.fromLine).toBe(1)
    expect(context.excerpt.toLine).toBe(5)
  })

  it('cuts a huge excerpt on a line boundary within the limit', () => {
    const wide = Array.from({ length: 40 }, () => 'y'.repeat(900)).join('\n')
    const context = build([marker(20, 'bad')], wide)
    expect(context.excerpt.text.length).toBeLessThanOrEqual(
      MAX_EDITOR_EXCERPT_CHARS
    )
    const kept = context.excerpt.text.split('\n').length
    expect(context.excerpt.toLine).toBe(context.excerpt.fromLine + kept - 1)
  })
})
