import { TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import {
  mountTestEditor,
  paragraphsBody,
  pressKey,
  runStart,
} from './editorTestKit'

type Harness = ReturnType<typeof mountTestEditor>

function select(harness: Harness, text: string, from: number, to: number) {
  const start = runStart(harness.editor.view.state.doc, text)
  harness.editor.view.dispatch(
    harness.editor.view.state.tr.setSelection(
      TextSelection.create(
        harness.editor.view.state.doc,
        start + from,
        start + to
      )
    )
  )
}

function runs(harness: Harness) {
  return harness.editor
    .getBody()
    .filter((node) => node.type === 'run')
    .map(({ nodeID, content, attributes }) => ({ nodeID, content, attributes }))
}

describe('inline formatting', () => {
  it.each([
    ['b', {}, 'bold'],
    ['i', {}, 'italic'],
    ['e', {}, 'code'],
    ['x', { shiftKey: true }, 'strike'],
  ])(
    'Ctrl+%s toggles the %s attribute on a split run',
    (key, extra, attribute) => {
      const harness = mountTestEditor(paragraphsBody('hello'))
      try {
        select(harness, 'hello', 1, 4)
        const event = pressKey(harness.editor.view.dom, key, {
          ctrlKey: true,
          ...extra,
        })
        expect(event.defaultPrevented).toBe(true)
        const result = runs(harness)
        expect(result.map((run) => run.content)).toEqual(['h', 'ell', 'o'])
        expect(result[0]).toEqual({
          nodeID: 'r0',
          content: 'h',
          attributes: {},
        })
        expect(result[1]!.attributes).toEqual({ [attribute]: true })
        expect(result[2]!.attributes).toEqual({})
        expect(new Set(result.map((run) => run.nodeID)).size).toBe(3)

        pressKey(harness.editor.view.dom, key, { ctrlKey: true, ...extra })
        expect(
          runs(harness).every((run) => !(attribute in run.attributes))
        ).toBe(true)
      } finally {
        harness.cleanup()
      }
    }
  )

  it('keeps the run ID when the whole run is formatted', () => {
    const harness = mountTestEditor(paragraphsBody('hello'))
    try {
      select(harness, 'hello', 0, 5)
      harness.editor.toggleMark('strong')
      expect(runs(harness)).toEqual([
        { nodeID: 'r0', content: 'hello', attributes: { bold: true } },
      ])
    } finally {
      harness.cleanup()
    }
  })

  it('sets and removes a link on the selection', () => {
    const harness = mountTestEditor(paragraphsBody('see docs now'))
    try {
      select(harness, 'see docs now', 4, 8)
      expect(harness.editor.setLink('https://example.com/docs')).toBe(true)
      expect(runs(harness).map((run) => run.attributes)).toEqual([
        {},
        { href: 'https://example.com/docs' },
        {},
      ])
      expect(harness.editor.getInlineState().link).toBe(
        'https://example.com/docs'
      )
      expect(harness.editor.removeLink()).toBe(true)
      expect(runs(harness).every((run) => !('href' in run.attributes))).toBe(
        true
      )
    } finally {
      harness.cleanup()
    }
  })

  it('refuses unsafe link targets', () => {
    const harness = mountTestEditor(paragraphsBody('see docs now'))
    try {
      select(harness, 'see docs now', 4, 8)
      expect(harness.editor.setLink('javascript:alert(1)')).toBe(false)
      expect(harness.editor.setLink('')).toBe(false)
      expect(runs(harness)).toHaveLength(1)
    } finally {
      harness.cleanup()
    }
  })

  it('reports active marks and the selection rectangle', () => {
    const seen: ReturnType<Harness['editor']['getInlineState']>[] = []
    const harness = mountTestEditor(paragraphsBody('hello'), {
      onInlineStateChange: (state) => seen.push(state),
    })
    try {
      expect(harness.editor.getInlineState().hasSelection).toBe(false)
      select(harness, 'hello', 0, 5)
      harness.editor.toggleMark('em')
      const state = harness.editor.getInlineState()
      expect(state.hasSelection).toBe(true)
      expect(state.marks.em).toBe(true)
      expect(state.marks.strong).toBe(false)
      expect(state.rect).not.toBeNull()
      expect(seen.at(-1)?.marks.em).toBe(true)
    } finally {
      harness.cleanup()
    }
  })

  it('does not format while read-only', () => {
    const harness = mountTestEditor(paragraphsBody('hello'))
    try {
      select(harness, 'hello', 0, 5)
      harness.editor.setReadOnly(true)
      expect(harness.editor.toggleMark('strong')).toBe(false)
      expect(runs(harness)[0]!.attributes).toEqual({})
    } finally {
      harness.cleanup()
    }
  })

  it('does not allow marks inside code blocks', () => {
    const body = paragraphsBody('x')
    body.push({
      nodeID: 'code',
      parentID: 'root',
      siblingOrder: 5,
      type: 'code-block',
      content: 'const a = 1',
      attributes: { type: 'fenced', lang: '', fenceLength: 3 },
    })
    const harness = mountTestEditor(body)
    try {
      let start = -1
      harness.editor.view.state.doc.descendants((node, position) => {
        if (node.type.name === 'code_block') start = position + 1
      })
      harness.editor.view.dispatch(
        harness.editor.view.state.tr.setSelection(
          TextSelection.create(harness.editor.view.state.doc, start, start + 5)
        )
      )
      harness.editor.toggleMark('strong')
      expect(
        harness.editor.getBody().find((node) => node.type === 'code-block')
          ?.attributes
      ).toEqual({ type: 'fenced', lang: '', fenceLength: 3 })
    } finally {
      harness.cleanup()
    }
  })
})
