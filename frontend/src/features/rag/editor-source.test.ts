import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fixQuestion,
  onFixRequest,
  readEditorContext,
  registerEditorSource,
  requestFix,
} from './editor-source'

const read = () => ({
  kind: 'dbml' as const,
  source: 'Table t {\n  id\n}',
  cursor: { line: 2, column: 3 },
  markers: [
    {
      startLineNumber: 2,
      startColumn: 3,
      endLineNumber: 2,
      endColumn: 5,
      message: 'Invalid column definition or missing type',
      severity: 8,
    },
  ],
})

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((stop) => stop()))
const track = (stop: () => void) => (cleanups.push(stop), stop)

describe('readEditorContext', () => {
  it('reads the editor of a document as it is when asked', () => {
    track(registerEditorSource('doc-1', read))
    const context = readEditorContext('doc-1')
    expect(context?.documentId).toBe('doc-1')
    expect(context?.diagnostics[0].message).toBe(
      'Invalid column definition or missing type'
    )
  })

  it('gives nothing for a document with no source editor open', () => {
    expect(readEditorContext('doc-2')).toBeUndefined()
  })

  it('forgets an editor once it is closed', () => {
    const stop = registerEditorSource('doc-1', read)
    stop()
    expect(readEditorContext('doc-1')).toBeUndefined()
  })

  it('keeps a newer editor of the same document when an older one closes', () => {
    const stopOld = registerEditorSource('doc-1', read)
    track(registerEditorSource('doc-1', () => ({ ...read(), kind: 'mermaid' })))
    stopOld()
    expect(readEditorContext('doc-1')?.kind).toBe('mermaid')
  })
})

describe('requestFix', () => {
  it('tells whoever listens for that document, with the error as a question', () => {
    const heard = vi.fn()
    track(onFixRequest('doc-1', heard))
    requestFix('doc-1', {
      line: 3,
      message: 'Invalid column definition or missing type',
    })
    expect(heard).toHaveBeenCalledWith(
      'Fix the error at line 3: Invalid column definition or missing type'
    )
  })

  it('does not reach a listener of another document or one that stopped', () => {
    const other = vi.fn()
    const stopped = vi.fn()
    track(onFixRequest('doc-2', other))
    onFixRequest('doc-1', stopped)()
    requestFix('doc-1', { line: 1, message: 'x' })
    expect(other).not.toHaveBeenCalled()
    expect(stopped).not.toHaveBeenCalled()
  })
})

describe('fixQuestion', () => {
  it('names the line and the message', () => {
    expect(fixQuestion({ line: 7, message: 'Unexpected closing brace' })).toBe(
      'Fix the error at line 7: Unexpected closing brace'
    )
  })
})
