import { describe, expect, it } from 'vitest'
import { documentBodyToMarkdown } from '../muya/state/documentBodyToMarkdown'
import { bodyBuilder } from './blocks/testSupport'

describe('a heading whose text sits in the heading itself', () => {
  it('exports its text, not undefined', () => {
    const b = bodyBuilder()
    const root = b.add(null, 'document')
    b.add(root, 'atx-heading', 'Opening', { level: 1 })
    expect(documentBodyToMarkdown(b.nodes).trim()).toBe('# Opening')
  })
})
