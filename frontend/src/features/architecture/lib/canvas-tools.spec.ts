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

  it('returns Eraser and Comment to Cursor after one use', () => {
    expect(afterUse('eraser')).toBe('cursor')
    expect(afterUse('comment')).toBe('cursor')
  })

  it('keeps Hand and Cursor active', () => {
    expect(afterUse('hand')).toBe('hand')
    expect(afterUse('cursor')).toBe('cursor')
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
