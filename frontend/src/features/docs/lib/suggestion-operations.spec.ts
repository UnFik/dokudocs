import { describe, expect, it } from 'vitest'
import type { DocumentBodyNode } from './documentBody'
import {
  buildDeleteBlockSuggestion,
  buildFormatSuggestion,
  buildInsertParagraphSuggestion,
  buildMoveBlockSuggestion,
  conflictReviewMessage,
  overlayCss,
  pendingOverlay,
  translateTextEdit,
} from './suggestion-operations'

const ROOT = '00000000-0000-4000-8000-000000000001'
const PARA = '00000000-0000-4000-8000-000000000002'
const RUN = '00000000-0000-4000-8000-000000000003'
const OPAQUE = '00000000-0000-4000-8000-000000000004'

function node(
  nodeID: string,
  parentID: string | null,
  type: string,
  content = ''
): DocumentBodyNode {
  return { nodeID, parentID, siblingOrder: 0, type, content, attributes: {} }
}

const body = [
  node(ROOT, null, 'document'),
  node(PARA, ROOT, 'paragraph'),
  node(RUN, PARA, 'run', 'Hello world'),
  node(OPAQUE, ROOT, 'opaque'),
]

describe('buildDeleteBlockSuggestion', () => {
  it('proposes deleting the block that contains a selected run', () => {
    const result = buildDeleteBlockSuggestion(body, RUN)
    expect(result.operations).toEqual([{ op: 'delete', nodeID: PARA }])
    expect(result.summary).toBe('Delete paragraph “Hello world”')
  })

  it('rejects the document root and opaque blocks', () => {
    expect(() => buildDeleteBlockSuggestion(body, ROOT)).toThrow(
      'The document root cannot be deleted'
    )
    expect(() => buildDeleteBlockSuggestion(body, OPAQUE)).toThrow(
      'This block cannot be changed by a suggestion'
    )
  })
})

describe('conflictReviewMessage', () => {
  it('explains a conflicted batch using the backend reason', () => {
    expect(conflictReviewMessage('conflicted', 'missing-node')).toBe(
      'Not applied: the target block no longer exists. Nothing was edited. Ask for a new suggestion on the current text.'
    )
    expect(conflictReviewMessage('conflicted', 'base')).toBe(
      'Not applied: the document changed after this was proposed. Nothing was edited. Ask for a new suggestion on the current text.'
    )
  })

  it('falls back to a generic message for unknown or empty reasons', () => {
    expect(conflictReviewMessage('conflicted', '')).toBe(
      'Not applied: this suggestion no longer fits the document. Nothing was edited. Ask for a new suggestion on the current text.'
    )
  })

  it('has no message for other statuses', () => {
    expect(conflictReviewMessage('pending', '')).toBeNull()
  })
})

const PARA2 = '00000000-0000-4000-8000-000000000005'
const RUN2 = '00000000-0000-4000-8000-000000000006'
const PARA3 = '00000000-0000-4000-8000-000000000007'
const withTwo = [
  node(ROOT, null, 'document'),
  { ...node(PARA, ROOT, 'paragraph'), siblingOrder: 1 },
  node(RUN, PARA, 'run', 'Hello world'),
  { ...node(PARA2, ROOT, 'paragraph'), siblingOrder: 2 },
  node(RUN2, PARA2, 'run', 'Second'),
  { ...node(PARA3, ROOT, 'paragraph'), siblingOrder: 3 },
]

describe('buildFormatSuggestion', () => {
  it('proposes turning a mark on for the whole run', () => {
    const result = buildFormatSuggestion(withTwo, RUN, 'bold')
    expect(result.operations).toEqual([
      { op: 'format', nodeID: RUN, attributes: { bold: true } },
    ])
    expect(result.summary).toBe('Make “Hello world” bold')
  })

  it('proposes removing a mark that is already on', () => {
    const bold = withTwo.map((item) =>
      item.nodeID === RUN ? { ...item, attributes: { bold: true } } : item
    )
    const result = buildFormatSuggestion(bold, RUN, 'bold')
    expect(result.operations[0]).toEqual({
      op: 'format',
      nodeID: RUN,
      attributes: { bold: false },
    })
    expect(result.summary).toBe('Remove bold from “Hello world”')
  })

  it('only formats runs', () => {
    expect(() => buildFormatSuggestion(withTwo, PARA, 'bold')).toThrow(
      'Place the cursor in text to format it'
    )
  })
})

describe('buildMoveBlockSuggestion', () => {
  it('moves a block above its previous sibling', () => {
    const result = buildMoveBlockSuggestion(withTwo, RUN2, 'up')
    expect(result.operations).toEqual([
      { op: 'move', nodeID: PARA2, targetParentID: ROOT, beforeNodeID: PARA },
    ])
    expect(result.summary).toBe('Move paragraph “Second” up')
  })

  it('moves a block below its next sibling, or to the end', () => {
    expect(buildMoveBlockSuggestion(withTwo, PARA, 'down').operations).toEqual([
      { op: 'move', nodeID: PARA, targetParentID: ROOT, beforeNodeID: PARA3 },
    ])
    expect(buildMoveBlockSuggestion(withTwo, PARA2, 'down').operations).toEqual(
      [{ op: 'move', nodeID: PARA2, targetParentID: ROOT }]
    )
  })

  it('refuses to move past the ends', () => {
    expect(() => buildMoveBlockSuggestion(withTwo, PARA, 'up')).toThrow(
      'This block is already first'
    )
    expect(() => buildMoveBlockSuggestion(withTwo, PARA3, 'down')).toThrow(
      'This block is already last'
    )
  })
})

describe('buildInsertParagraphSuggestion', () => {
  const ids = ['id-para', 'id-run']
  const newID = () => ids.shift() as string

  it('inserts a paragraph and run, then moves it right after the anchor block', () => {
    const result = buildInsertParagraphSuggestion(
      withTwo,
      RUN,
      'New text',
      newID
    )
    expect(result.operations).toEqual([
      {
        op: 'insert',
        nodeID: 'id-para',
        parentID: ROOT,
        type: 'paragraph',
        content: '',
        attributes: {},
      },
      {
        op: 'insert',
        nodeID: 'id-run',
        parentID: 'id-para',
        type: 'run',
        content: 'New text',
        attributes: {},
      },
      {
        op: 'move',
        nodeID: 'id-para',
        targetParentID: ROOT,
        beforeNodeID: PARA2,
      },
    ])
    expect(result.summary).toBe('Insert paragraph “New text”')
  })

  it('skips the move when the anchor is the last block', () => {
    const result = buildInsertParagraphSuggestion(withTwo, PARA3, 'Tail', () =>
      crypto.randomUUID()
    )
    expect(result.operations.map((item) => item.op)).toEqual([
      'insert',
      'insert',
    ])
  })

  it('requires text', () => {
    expect(() =>
      buildInsertParagraphSuggestion(withTwo, RUN, '  ', () => 'x')
    ).toThrow('Enter text to insert')
  })
})

describe('pendingOverlay', () => {
  const suggestion = (status: string, operations: unknown) => ({
    status,
    operations,
  })

  it('maps pending operations onto the nodes they touch', () => {
    const overlay = pendingOverlay([
      suggestion('pending', [
        { op: 'delete', nodeID: PARA },
        { op: 'replace_text', nodeID: RUN2, content: 'x' },
      ]),
      suggestion('pending', [{ op: 'format', nodeID: RUN2, attributes: {} }]),
      suggestion('pending', [{ op: 'move', nodeID: PARA3 }]),
    ])
    expect(overlay.get(PARA)).toEqual(['delete'])
    expect(overlay.get(RUN2)).toEqual(['replace_text', 'format'])
    expect(overlay.get(PARA3)).toEqual(['move'])
  })

  it('ignores resolved suggestions and malformed operations', () => {
    const overlay = pendingOverlay([
      suggestion('accepted', [{ op: 'delete', nodeID: PARA }]),
      suggestion('conflicted', [{ op: 'delete', nodeID: PARA }]),
      suggestion('pending', 'not-an-array'),
      suggestion('pending', [{ op: 'insert', nodeID: 'new' }, { nope: 1 }]),
    ])
    expect(overlay.size).toBe(0)
  })
})

describe('overlayCss', () => {
  it('styles each marked node by id and kind without touching the editor DOM', () => {
    const css = overlayCss(
      new Map([
        [PARA, ['delete']],
        [RUN2, ['replace_text', 'format']],
      ])
    )
    expect(css).toContain(`.markdown-body [data-node-id="${PARA}"]`)
    expect(css).toContain('line-through')
    expect(css).toContain(`.markdown-body [data-node-id="${RUN2}"]`)
    expect(css).toContain('underline')
  })

  it('drops ids that are not UUIDs so the stylesheet cannot be injected into', () => {
    expect(overlayCss(new Map([['"] { color: red } x[', ['delete']]]))).toBe('')
  })
})

describe('translateTextEdit', () => {
  const changed = (content: string) =>
    body.map((item) => (item.nodeID === RUN ? { ...item, content } : item))

  it('turns an edit inside one run into a replace_text suggestion', () => {
    const result = translateTextEdit(body, changed('Hello brave world'))
    expect(result).toEqual({
      ok: true,
      draft: {
        operations: [
          { op: 'replace_text', nodeID: RUN, content: 'Hello brave world' },
        ],
        summary: 'Insert “brave ” in “Hello world”',
      },
    })
  })

  it('describes a deletion', () => {
    const result = translateTextEdit(body, changed('Hello'))
    expect(result.ok && result.draft.summary).toBe(
      'Delete “ world” from “Hello world”'
    )
  })

  it('describes a replacement', () => {
    const result = translateTextEdit(body, changed('Hello there'))
    expect(result.ok && result.draft.summary).toBe(
      'Replace “world” with “there” in “Hello world”'
    )
  })

  it('refuses a split that adds blocks and points to the panel actions', () => {
    const split = [
      ...body,
      node('00000000-0000-4000-8000-000000000009', ROOT, 'paragraph'),
    ]
    const result = translateTextEdit(body, split)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toBe(
      'Typing can only change text inside one run. Use Suggest insert below, Suggest delete block, or the move actions in the suggestions panel.'
    )
  })

  it('refuses a removed block', () => {
    const result = translateTextEdit(
      body,
      body.filter((item) => item.nodeID !== RUN)
    )
    expect(result.ok).toBe(false)
  })

  it('refuses edits that touch two runs', () => {
    const two = [...body, node('00000000-0000-4000-8000-00000000000a', PARA, 'run', 'x')]
    const after = two.map((item) =>
      item.type === 'run' ? { ...item, content: item.content + '!' } : item
    )
    expect(translateTextEdit(two, after).ok).toBe(false)
  })

  it('refuses when nothing changed', () => {
    expect(translateTextEdit(body, body).ok).toBe(false)
  })
})
