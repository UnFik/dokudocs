import '@/styles/index.css'
import * as monaco from 'monaco-editor'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { switchLocalUser } from '@/lib/user-storage'
import { onFixRequest, readEditorContext } from '@/features/rag/editor-source'
import { DbmlEditor } from './dbml-editor'

const userID = '11111111-1111-4111-8111-111111111111'
const documentID = '33333333-3333-4333-8333-333333333333'
const source = 'Table a {\n  id\n}'
const error = 'Invalid column definition or missing type'

beforeEach(() => switchLocalUser(userID))
afterEach(() => switchLocalUser(null))

const ready = () =>
  vi.waitFor(() => expect(monaco.editor.getEditors().length).toBeGreaterThan(0))

it('lets the chat read the errors of the open editor, until it closes', async () => {
  const screen = await render(
    <div style={{ height: 500 }}>
      <DbmlEditor docId={documentID} content={source} onChange={vi.fn()} />
    </div>
  )
  await ready()
  monaco.editor.getEditors()[0].setPosition({ lineNumber: 2, column: 3 })
  await vi.waitFor(() =>
    expect(readEditorContext(documentID)?.diagnostics).toEqual([
      expect.objectContaining({ line: 2, severity: 'error', message: error }),
    ])
  )
  expect(readEditorContext(documentID)).toMatchObject({
    kind: 'dbml',
    cursor: { line: 2, column: 3 },
  })
  await screen.unmount()
  expect(readEditorContext(documentID)).toBeUndefined()
})

it('offers Fix with AI on an error and hands it to the chat of the document', async () => {
  const heard = vi.fn()
  const stop = onFixRequest(documentID, heard)
  await render(
    <div style={{ height: 500 }}>
      <DbmlEditor docId={documentID} content={source} onChange={vi.fn()} />
    </div>
  )
  await ready()
  const editor = monaco.editor.getEditors()[0]
  await vi.waitFor(() =>
    expect(readEditorContext(documentID)?.diagnostics).toHaveLength(1)
  )
  editor.focus()
  editor.setPosition({ lineNumber: 2, column: 3 })
  editor.trigger('test', 'editor.action.codeAction', {
    kind: 'quickfix',
    apply: 'first',
  })
  await vi.waitFor(() =>
    expect(heard).toHaveBeenCalledWith(`Fix the error at line 2: ${error}`)
  )
  stop()
})
