import { describe, expect, it } from 'vitest'
import type { DocumentBodyNode } from './documentBody'
import {
  buildDeleteBlockSuggestion,
  conflictReviewMessage,
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
  it('tells reviewers a conflicted batch changed nothing and must be re-proposed', () => {
    expect(conflictReviewMessage('conflicted')).toBe(
      'Not applied: the document changed since this was proposed. Nothing was edited. Ask for a new suggestion on the current text.'
    )
  })

  it('has no message for other statuses', () => {
    expect(conflictReviewMessage('pending')).toBeNull()
  })
})
