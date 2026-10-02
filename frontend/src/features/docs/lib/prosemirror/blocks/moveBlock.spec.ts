import { EditorState } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { documentBodyToProseMirror } from '../documentBody'
import {
  MoveNodeRequiredError,
  prepareBodyTransaction,
} from '../prepareBodyTransaction'
import { moveTopLevelBlock } from './moveBlock'
import { bodyBuilder } from './testSupport'

function state() {
  const b = bodyBuilder()
  const root = b.add(null, 'document')
  const ids = ['a', 'b', 'c'].map((t) => {
    const p = b.add(root, 'paragraph')
    b.add(p, 'run', t)
    return p
  })
  return {
    root,
    ids,
    state: EditorState.create({ doc: documentBodyToProseMirror(b.nodes) }),
  }
}

describe('moveTopLevelBlock', () => {
  it('turns a drag into a MoveNode intent', () => {
    const s = state()
    const tr = moveTopLevelBlock(s.state, 0, 3)!
    try {
      prepareBodyTransaction(s.state, tr)
      throw new Error('expected MoveNodeRequiredError')
    } catch (error) {
      expect(error).toBeInstanceOf(MoveNodeRequiredError)
      const move = error as MoveNodeRequiredError
      expect(move.nodeID).toBe(s.ids[0])
      expect(move.targetParentID).toBe(s.root)
      expect(move.beforeNodeID).toBeNull()
    }
  })

  it('moves before a given sibling', () => {
    const s = state()
    const tr = moveTopLevelBlock(s.state, 2, 0)!
    try {
      prepareBodyTransaction(s.state, tr)
    } catch (error) {
      expect((error as MoveNodeRequiredError).beforeNodeID).toBe(s.ids[0])
    }
  })

  it('ignores moves that change nothing or are out of range', () => {
    const s = state()
    expect(moveTopLevelBlock(s.state, 1, 1)).toBeNull()
    expect(moveTopLevelBlock(s.state, 1, 2)).toBeNull()
    expect(moveTopLevelBlock(s.state, 5, 0)).toBeNull()
  })
})
