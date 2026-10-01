import { TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import type { DocumentBodyNode } from '../documentBody'
import {
  mountTestEditor,
  paragraphsBody,
  pressKey,
  runStart,
} from './editorTestKit'

type Harness = ReturnType<typeof mountTestEditor>

function caret(harness: Harness, text: string, offset: number) {
  const position = runStart(harness.editor.view.state.doc, text) + offset
  harness.editor.view.dispatch(
    harness.editor.view.state.tr.setSelection(
      TextSelection.create(harness.editor.view.state.doc, position)
    )
  )
}

function typeText(harness: Harness, text: string) {
  const { view } = harness.editor
  const { from, to } = view.state.selection
  const handled = view.someProp('handleTextInput', (handler) =>
    handler(view, from, to, text, () =>
      view.state.tr.insertText(text, from, to)
    )
  )
  if (!handled) view.dispatch(view.state.tr.insertText(text, from, to))
}

function node(harness: Harness, nodeID: string) {
  return harness.editor.getBody().find((item) => item.nodeID === nodeID)
}

function listBody(kind: 'bullet-list' | 'task-list'): DocumentBodyNode[] {
  const item = kind === 'bullet-list' ? 'list-item' : 'task-list-item'
  const attrs =
    kind === 'bullet-list'
      ? { marker: '-', loose: false }
      : { marker: '-', loose: false }
  return [
    {
      nodeID: 'root',
      parentID: null,
      siblingOrder: 0,
      type: 'document',
      content: '',
      attributes: {},
    },
    {
      nodeID: 'list',
      parentID: 'root',
      siblingOrder: 0,
      type: kind,
      content: '',
      attributes: attrs,
    },
    {
      nodeID: 'item',
      parentID: 'list',
      siblingOrder: 0,
      type: item,
      content: '',
      attributes: kind === 'task-list' ? { checked: true } : {},
    },
    {
      nodeID: 'para',
      parentID: 'item',
      siblingOrder: 0,
      type: 'paragraph',
      content: '',
      attributes: {},
    },
    {
      nodeID: 'run',
      parentID: 'para',
      siblingOrder: 0,
      type: 'run',
      content: 'first second',
      attributes: {},
    },
  ]
}

describe('heading commands', () => {
  it('turns a paragraph into a heading in place with Ctrl+Alt+digit and back with 0', () => {
    const harness = mountTestEditor(paragraphsBody('Title'))
    try {
      caret(harness, 'Title', 2)
      const event = pressKey(harness.editor.view.dom, '2', {
        ctrlKey: true,
        altKey: true,
      })
      expect(event.defaultPrevented).toBe(true)
      expect(node(harness, 'p0')).toMatchObject({
        type: 'atx-heading',
        parentID: 'root',
        attributes: { level: 2 },
      })
      expect(node(harness, 'r0')).toMatchObject({
        parentID: 'p0',
        content: 'Title',
      })

      pressKey(harness.editor.view.dom, '4', { ctrlKey: true, altKey: true })
      expect(node(harness, 'p0')?.attributes).toEqual({ level: 4 })

      pressKey(harness.editor.view.dom, '0', { ctrlKey: true, altKey: true })
      expect(node(harness, 'p0')).toMatchObject({
        type: 'paragraph',
        attributes: {},
      })
    } finally {
      harness.cleanup()
    }
  })

  it('converts "# " typed at the start of a paragraph that has text', () => {
    const harness = mountTestEditor(paragraphsBody('Title'))
    try {
      caret(harness, 'Title', 0)
      typeText(harness, '#')
      typeText(harness, '#')
      typeText(harness, ' ')
      expect(node(harness, 'p0')).toMatchObject({
        type: 'atx-heading',
        attributes: { level: 2 },
      })
      expect(node(harness, 'r0')?.content).toBe('Title')
    } finally {
      harness.cleanup()
    }
  })

  it('leaves "# " as text when the paragraph would lose its only run', () => {
    const harness = mountTestEditor(paragraphsBody('#'))
    try {
      caret(harness, '#', 1)
      typeText(harness, ' ')
      expect(node(harness, 'p0')?.type).toBe('paragraph')
      expect(node(harness, 'r0')?.content).toBe('# ')
    } finally {
      harness.cleanup()
    }
  })

  it('does nothing while read-only', () => {
    const harness = mountTestEditor(paragraphsBody('Title'))
    try {
      caret(harness, 'Title', 2)
      harness.editor.setReadOnly(true)
      expect(harness.editor.setHeading(1)).toBe(false)
      expect(node(harness, 'p0')?.type).toBe('paragraph')
    } finally {
      harness.cleanup()
    }
  })
})

describe('Enter', () => {
  it('splits a paragraph, keeping the original IDs on the first half', () => {
    const harness = mountTestEditor(paragraphsBody('hello world'))
    try {
      caret(harness, 'hello world', 5)
      const event = pressKey(harness.editor.view.dom, 'Enter')
      expect(event.defaultPrevented).toBe(true)
      const body = harness.editor.getBody()
      const paragraphs = body.filter((item) => item.type === 'paragraph')
      expect(paragraphs).toHaveLength(2)
      expect(paragraphs[0]!.nodeID).toBe('p0')
      expect(node(harness, 'r0')?.content).toBe('hello')
      const second = body.find(
        (item) => item.parentID === paragraphs[1]!.nodeID
      )
      expect(second?.content).toBe(' world')
      expect(new Set(body.map((item) => item.nodeID)).size).toBe(body.length)
    } finally {
      harness.cleanup()
    }
  })

  it('adds a new bullet item with fresh IDs', () => {
    const harness = mountTestEditor(listBody('bullet-list'))
    try {
      caret(harness, 'first second', 5)
      pressKey(harness.editor.view.dom, 'Enter')
      const body = harness.editor.getBody()
      const items = body.filter((item) => item.type === 'list-item')
      expect(items).toHaveLength(2)
      expect(items[0]!.nodeID).toBe('item')
      expect(items[1]!.parentID).toBe('list')
      expect(new Set(body.map((item) => item.nodeID)).size).toBe(body.length)
    } finally {
      harness.cleanup()
    }
  })

  it('starts the next task item unchecked', () => {
    const harness = mountTestEditor(listBody('task-list'))
    try {
      caret(harness, 'first second', 5)
      pressKey(harness.editor.view.dom, 'Enter')
      const items = harness.editor
        .getBody()
        .filter((item) => item.type === 'task-list-item')
      expect(items.map((item) => item.attributes)).toEqual([
        { checked: true },
        { checked: false },
      ])
    } finally {
      harness.cleanup()
    }
  })
})

describe('Enter in headings', () => {
  it('starts a paragraph after a heading when Enter is pressed at its end', () => {
    const harness = mountTestEditor(paragraphsBody('Title'))
    try {
      harness.editor.view.dispatch(
        harness.editor.view.state.tr.setSelection(
          TextSelection.create(
            harness.editor.view.state.doc,
            runStart(harness.editor.view.state.doc, 'Title') + 2
          )
        )
      )
      harness.editor.setHeading(1)
      caret(harness, 'Title', 5)
      pressKey(harness.editor.view.dom, 'Enter')
      const body = harness.editor.getBody()
      expect(node(harness, 'p0')?.type).toBe('atx-heading')
      const next = body.filter((item) => item.parentID === 'root')[1]
      expect(next).toMatchObject({ type: 'paragraph', attributes: {} })
    } finally {
      harness.cleanup()
    }
  })
})

describe('task items', () => {
  it('toggles the checked state in place with Mod+Enter', () => {
    const harness = mountTestEditor(listBody('task-list'))
    try {
      caret(harness, 'first second', 3)
      const event = pressKey(harness.editor.view.dom, 'Enter', {
        ctrlKey: true,
      })
      expect(event.defaultPrevented).toBe(true)
      expect(node(harness, 'item')?.attributes).toEqual({ checked: false })
      expect(harness.editor.toggleTask()).toBe(true)
      expect(node(harness, 'item')?.attributes).toEqual({ checked: true })
    } finally {
      harness.cleanup()
    }
  })

  it('does nothing outside a task item or while read-only', () => {
    const plain = mountTestEditor(paragraphsBody('hello'))
    try {
      caret(plain, 'hello', 1)
      expect(plain.editor.toggleTask()).toBe(false)
    } finally {
      plain.cleanup()
    }
    const harness = mountTestEditor(listBody('task-list'))
    try {
      caret(harness, 'first second', 3)
      harness.editor.setReadOnly(true)
      expect(harness.editor.toggleTask()).toBe(false)
      expect(node(harness, 'item')?.attributes).toEqual({ checked: true })
    } finally {
      harness.cleanup()
    }
  })
})
