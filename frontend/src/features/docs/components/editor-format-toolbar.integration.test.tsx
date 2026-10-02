import { useEffect, useRef, useState } from 'react'
import { TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import type {
  createDocumentBodyEditor,
  EditorHistoryState,
} from '../lib/prosemirror/createDocumentBodyEditor'
import {
  mountTestEditor,
  paragraphsBody,
  pressKey,
  runStart,
} from '../lib/prosemirror/editorTestKit'
import {
  emptyInlineState,
  type InlineState,
} from '../lib/prosemirror/inlineMarks'
import { HistoryButtons, SelectionToolbar } from './editor-format-toolbar'

type Editor = ReturnType<typeof createDocumentBodyEditor>

// Wires the real editor to the real toolbar the way remote-markdown-doc-editor does.
function Harness({ onReady }: { onReady: (editor: Editor) => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const [history, setHistory] = useState<EditorHistoryState>({
    canUndo: false,
    canRedo: false,
  })
  const [inline, setInline] = useState<InlineState>(emptyInlineState)
  const [linkRequest, setLinkRequest] = useState(0)

  useEffect(() => {
    const mounted = mountTestEditor(paragraphsBody('see docs now'), {
      onHistoryChange: setHistory,
      onInlineStateChange: setInline,
      onLinkRequest: () => setLinkRequest((count) => count + 1),
    })
    hostRef.current?.append(mounted.host)
    editorRef.current = mounted.editor
    onReady(mounted.editor)
    return () => mounted.cleanup()
  }, [onReady])

  return (
    <div>
      <HistoryButtons
        history={history}
        onUndo={() => editorRef.current?.undo()}
        onRedo={() => editorRef.current?.redo()}
      />
      <div ref={hostRef} />
      <SelectionToolbar
        inline={inline}
        linkRequest={linkRequest}
        onToggleMark={(mark) => editorRef.current?.toggleMark(mark)}
        onSetLink={(href) => editorRef.current?.setLink(href) ?? false}
        onRemoveLink={() => editorRef.current?.removeLink()}
      />
    </div>
  )
}

function select(editor: Editor, from: number, to: number) {
  const start = runStart(editor.view.state.doc, 'see docs now')
  editor.view.dispatch(
    editor.view.state.tr.setSelection(
      TextSelection.create(editor.view.state.doc, start + from, start + to)
    )
  )
}

describe('toolbar wired to the real editor', () => {
  it('bolds the selection from the toolbar, undoes it, and sets a link with Ctrl+K', async () => {
    let editor!: Editor
    const view = await render(
      <Harness onReady={(next) => void (editor = next)} />
    )
    await expect.poll(() => Boolean(editor)).toBe(true)

    expect(view.container.querySelector('[role="toolbar"]')).toBeNull()
    select(editor, 4, 8)
    await view.getByRole('button', { name: 'Bold' }).click()
    expect(
      editor
        .getBody()
        .filter((node) => node.type === 'run')
        .map((node) => [node.content, node.attributes])
    ).toEqual([
      ['see ', {}],
      ['docs', { bold: true }],
      [' now', {}],
    ])
    await expect
      .element(view.getByRole('button', { name: 'Bold' }))
      .toHaveAttribute('aria-pressed', 'true')

    await view.getByRole('button', { name: 'Undo' }).click()
    expect(
      editor
        .getBody()
        .filter((node) => node.type === 'run')
        .every((node) => !node.attributes.bold)
    ).toBe(true)

    select(editor, 4, 8)
    pressKey(editor.view.dom, 'k', { ctrlKey: true })
    const input = view.getByRole('textbox', { name: 'Link address' })
    await input.fill('https://example.com')
    await view.getByRole('button', { name: 'Apply link' }).click()
    expect(
      editor
        .getBody()
        .filter((node) => node.type === 'run')
        .map((node) => node.attributes.href ?? null)
    ).toEqual([null, 'https://example.com', null])
  })
})
