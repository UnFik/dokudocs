import * as monaco from 'monaco-editor'
import { afterEach, describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { setupMonaco } from './monaco-setup'
import { bindSourceEditor, type SourceBinding } from './source-binding'

setupMonaco()

type Peer = {
  doc: Y.Doc
  text: Y.Text
  awareness: Awareness
  editor: monaco.editor.IStandaloneCodeEditor
  binding: SourceBinding
}

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function peer(seed?: string, options: { readOnly?: boolean } = {}): Peer {
  const doc = new Y.Doc()
  const text = doc.getText('source')
  if (seed !== undefined) text.insert(0, seed)
  const awareness = new Awareness(doc)
  const host = document.createElement('div')
  host.style.cssText = 'width:600px;height:300px'
  document.body.append(host)
  const editor = monaco.editor.create(host, { language: 'dbml' })
  const binding = bindSourceEditor({
    text,
    editor,
    awareness,
    readOnly: options.readOnly,
  })
  cleanups.push(() => {
    binding.destroy()
    editor.dispose()
    awareness.destroy()
    host.remove()
  })
  return { doc, text, awareness, editor, binding }
}

// Relays document and awareness updates both ways, as the room does.
function connect(a: Peer, b: Peer) {
  Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc))
  Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc))
  const relay = (to: Y.Doc) => (update: Uint8Array, origin: unknown) => {
    if (origin !== 'relay') Y.applyUpdate(to, update, 'relay')
  }
  a.doc.on('update', relay(b.doc))
  b.doc.on('update', relay(a.doc))
  const share = (from: Awareness, to: Awareness) => () => {
    const state = from.getStates().get(from.clientID)
    if (state) to.getStates().set(from.clientID, state)
    to.emit('change', [
      { added: [], updated: [from.clientID], removed: [] },
      'relay',
    ])
  }
  a.awareness.on('update', share(a.awareness, b.awareness))
  b.awareness.on('update', share(b.awareness, a.awareness))
}

function type(p: Peer, line: number, column: number, text: string) {
  p.editor.focus()
  p.editor.setPosition({ lineNumber: line, column })
  p.editor.trigger('keyboard', 'type', { text })
}

const value = (p: Peer) => p.editor.getModel()!.getValue()

describe('a source editor bound to the shared text', () => {
  it('shows the shared source and keeps two editors in step: typing, paste, Unicode and invalid syntax', () => {
    const a = peer('Table users {\n  id int\n}')
    const b = peer()
    connect(a, b)
    expect(value(b)).toBe('Table users {\n  id int\n}')

    type(a, 2, 9, ' [pk]')
    b.editor.executeEdits('paste', [
      {
        range: new monaco.Range(3, 2, 3, 2),
        text: '\nTable posts {\n  title varchar\n',
      },
    ])
    type(b, 1, 1, '😀é ')
    a.editor.executeEdits('typing', [
      { range: new monaco.Range(1, 1, 1, 1), text: 'Ref: >< {{ ' },
    ])

    expect(a.text.toString()).toBe(b.text.toString())
    expect(value(a)).toBe(a.text.toString())
    expect(value(b)).toBe(b.text.toString())
    expect(a.text.toString()).toContain('😀é ')
    expect(a.text.toString()).toContain('id int [pk]')
  })

  it('clears to empty text', () => {
    const a = peer('Table a {}')
    a.editor.executeEdits('clear', [
      { range: a.editor.getModel()!.getFullModelRange(), text: '' },
    ])
    expect(a.text.toString()).toBe('')
  })

  it('keeps the caret in place when someone else edits above it', () => {
    const a = peer('line one\nline two')
    const b = peer()
    connect(a, b)
    b.editor.setPosition({ lineNumber: 2, column: 6 })
    a.editor.executeEdits('typing', [
      { range: new monaco.Range(1, 1, 1, 1), text: 'new\n' },
    ])
    expect(b.editor.getPosition()).toEqual(new monaco.Position(3, 6))
  })

  it('keeps pasted Windows line endings as LF in the shared source', () => {
    const a = peer('')
    a.editor.executeEdits('paste', [
      { range: new monaco.Range(1, 1, 1, 1), text: 'a\r\nb\r\n' },
    ])
    expect(a.text.toString()).toBe('a\nb\n')
  })

  it("undoes and redoes only this person's edits", () => {
    const a = peer('x')
    const b = peer()
    connect(a, b)
    type(a, 1, 2, 'A')
    a.binding.stopCapturing()
    type(b, 1, 1, 'B')
    expect(a.binding.canUndo()).toBe(true)
    a.binding.undo()
    expect(b.text.toString()).toBe('Bx')
    a.binding.redo()
    expect(a.text.toString()).toBe('BxA')
    // Someone else's edit is not in this person's history.
    b.binding.undo()
    expect(a.text.toString()).toBe('xA')
    expect(b.binding.canUndo()).toBe(false)
  })

  it('replaces the source as one undoable step that keeps what others wrote outside the change', () => {
    const a = peer('Table a {\nid int\n}\n\nTable b {}')
    const b = peer()
    connect(a, b)
    type(a, 5, 11, ' ')
    a.binding.stopCapturing()
    // Format: only the indentation on line 2 changes.
    a.binding.replace('Table a {\n  id int\n}\n\nTable b {} ')
    expect(b.text.toString()).toBe('Table a {\n  id int\n}\n\nTable b {} ')
    // Someone else edits the part the replacement did not touch.
    b.editor.executeEdits('typing', [
      { range: new monaco.Range(4, 1, 4, 1), text: '// note' },
    ])
    a.binding.undo()
    expect(a.text.toString()).toBe('Table a {\nid int\n}\n// note\nTable b {} ')
    a.binding.undo()
    expect(a.text.toString()).toBe('Table a {\nid int\n}\n// note\nTable b {}')
  })

  it('lets someone who may only read neither type nor replace', () => {
    const a = peer('graph TD', { readOnly: true })
    type(a, 1, 9, '\n  A')
    a.binding.replace('flowchart LR')
    expect(a.text.toString()).toBe('graph TD')
    expect(value(a)).toBe('graph TD')
  })

  it("shows someone else's selection", () => {
    const a = peer('hello world')
    const b = peer()
    connect(a, b)
    a.editor.focus()
    a.editor.setSelection(new monaco.Selection(1, 1, 1, 6))
    const remote = b.editor
      .getModel()!
      .getAllDecorations()
      .filter((d) => d.options.className?.startsWith('yRemoteSelection'))
    expect(remote).toHaveLength(1)
    expect(remote[0].range).toEqual(new monaco.Range(1, 1, 1, 6))
  })

  it('keeps typing and remote edits quick on a large source', () => {
    // About 250 KB: 1200 DBML tables.
    const table = (i: number) =>
      `Table orders_${i} {\n  id int [pk, increment]\n  customer_id int [ref: > customers.id]\n  total decimal(10,2) [not null]\n  status varchar(32)\n  created_at timestamp\n}\n\n`
    const a = peer(Array.from({ length: 1200 }, (_, i) => table(i)).join(''))
    const b = peer()
    connect(a, b)
    const timed = (runs: number, f: (i: number) => void) => {
      const started = performance.now()
      for (let i = 0; i < runs; i++) f(i)
      return (performance.now() - started) / runs
    }
    const typingMs = timed(200, (i) => type(a, 4000 + i, 3, 'x'))
    const remoteMs = timed(200, (i) =>
      b.editor.executeEdits('typing', [
        { range: new monaco.Range(100 + i, 1, 100 + i, 1), text: 'y' },
      ])
    )
    // Measured for #122 at about 0.6 ms and 0.1 ms; the bound is generous so slow CI does not flake.
    expect(value(a)).toBe(value(b))
    expect(typingMs).toBeLessThan(50)
    expect(remoteMs).toBeLessThan(50)
  })

  it('stops syncing and sharing the selection once destroyed', () => {
    const a = peer('hello')
    a.binding.destroy()
    a.editor.executeEdits('typing', [
      { range: new monaco.Range(1, 1, 1, 1), text: 'y' },
    ])
    expect(a.text.toString()).toBe('hello')
    a.awareness.setLocalStateField('selection', null)
    a.editor.setSelection(new monaco.Selection(1, 1, 1, 3))
    expect(a.awareness.getLocalState()?.selection).toBeNull()
  })
})
