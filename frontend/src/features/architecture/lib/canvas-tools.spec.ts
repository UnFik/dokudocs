import { describe, expect, it } from 'vitest'
import { afterUse, toolForKey, toolsFor } from './canvas-tools'

describe('canvas tools', () => {
  it('maps the tool keys, in either case', () => {
    expect(toolForKey('v')).toBe('cursor')
    expect(toolForKey('H')).toBe('hand')
    expect(toolForKey('e')).toBe('eraser')
    expect(toolForKey('c')).toBe('comment')
    expect(toolForKey('x')).toBeNull()
  })

  it('returns Eraser and Comment to Cursor after one use unless the tool is locked', () => {
    expect(afterUse('eraser', false)).toBe('cursor')
    expect(afterUse('comment', false)).toBe('cursor')
    expect(afterUse('eraser', true)).toBe('eraser')
    expect(afterUse('comment', true)).toBe('comment')
  })

  it('keeps Hand and Cursor active, locked or not', () => {
    expect(afterUse('hand', false)).toBe('hand')
    expect(afterUse('cursor', false)).toBe('cursor')
  })

  it('offers each person only the tools their access allows', () => {
    expect(toolsFor({ canEdit: false, canComment: false })).toEqual([
      'hand',
      'cursor',
    ])
    expect(toolsFor({ canEdit: false, canComment: true })).toEqual([
      'hand',
      'cursor',
      'comment',
    ])
    expect(toolsFor({ canEdit: true, canComment: true })).toEqual([
      'hand',
      'cursor',
      'eraser',
      'comment',
    ])
  })
})
