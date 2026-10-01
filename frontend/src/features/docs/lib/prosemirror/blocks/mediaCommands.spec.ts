import { describe, expect, it } from 'vitest'
import {
  insertDiagram,
  insertImage,
  insertInlineMath,
  insertMathBlock,
  isSafeImageSource,
  updateImage,
} from './mediaCommands'
import { bodyBuilder, bodyOf, run, stateFor } from './testSupport'

function paragraph(text = '') {
  const b = bodyBuilder()
  const root = b.add(null, 'document')
  const p = b.add(root, 'paragraph')
  if (text) b.add(p, 'run', text)
  return { b, root, p }
}

describe('isSafeImageSource', () => {
  it('accepts web, relative and data image URLs only', () => {
    expect(isSafeImageSource('https://example.com/a.png')).toBe(true)
    expect(isSafeImageSource('/files/a.png')).toBe(true)
    expect(isSafeImageSource('./a.png')).toBe(true)
    expect(isSafeImageSource('data:image/png;base64,AAAA')).toBe(true)
    expect(isSafeImageSource('javascript:alert(1)')).toBe(false)
    expect(isSafeImageSource('data:text/html,<script>')).toBe(false)
    expect(isSafeImageSource('')).toBe(false)
  })
})

describe('insertImage', () => {
  it('inserts an inline image node with src and alt', () => {
    const { b, p } = paragraph('hi')
    const result = run(
      stateFor(b.nodes, p, 0),
      insertImage({ src: 'https://example.com/a.png', alt: 'logo' })
    )
    expect(result.ok).toBe(true)
    const image = bodyOf(result.state.doc).find((n) => n.type === 'image')!
    expect(image.attributes).toEqual({
      src: 'https://example.com/a.png',
      alt: 'logo',
    })
  })

  it('rejects unsafe sources', () => {
    const { b, p } = paragraph()
    const state = stateFor(b.nodes, p)
    expect(insertImage({ src: 'javascript:alert(1)', alt: '' })(state)).toBe(
      false
    )
  })

  it('updates src and alt while keeping the node ID', () => {
    const { b, p } = paragraph()
    const first = run(
      stateFor(b.nodes, p),
      insertImage({ src: '/a.png', alt: 'a' })
    ).state
    const before = bodyOf(first.doc).find((n) => n.type === 'image')!
    let pos = -1
    first.doc.descendants((node, position) => {
      if (node.type.name === 'image') pos = position
    })
    const updated = run(
      first,
      updateImage(pos, { src: '/b.png', alt: 'b' })
    ).state
    const after = bodyOf(updated.doc).find((n) => n.type === 'image')!
    expect(after.nodeID).toBe(before.nodeID)
    expect(after.attributes).toEqual({ src: '/b.png', alt: 'b' })
  })
})

describe('math and diagrams', () => {
  it('inserts inline math with a marker and source text', () => {
    const { b, p } = paragraph('a')
    const result = run(stateFor(b.nodes, p), insertInlineMath)
    const math = bodyOf(result.state.doc).find((n) => n.type === 'math')!
    expect(math.content).not.toBe('')
    expect(math.attributes).toEqual({ marker: '$' })
  })

  it('inserts a math block after the current block, keeping the cursor inside', () => {
    const { b, p } = paragraph('a')
    const result = run(stateFor(b.nodes, p), insertMathBlock)
    const body = bodyOf(result.state.doc)
    const block = body.find((n) => n.type === 'math-block')!
    expect(block.attributes).toEqual({ mathStyle: '' })
    expect(result.state.selection.$from.parent.type.name).toBe('math_block')
    expect(body.find((n) => n.type === 'paragraph')).toBeDefined()
  })

  it('replaces an empty paragraph with a mermaid diagram', () => {
    const { b, p } = paragraph()
    const result = run(stateFor(b.nodes, p), insertDiagram('mermaid'))
    const body = bodyOf(result.state.doc)
    const diagram = body.find((n) => n.type === 'diagram')!
    expect(diagram.attributes).toEqual({ type: 'mermaid', lang: 'yaml' })
    expect(diagram.content.length).toBeGreaterThan(0)
    expect(body.some((n) => n.type === 'paragraph')).toBe(false)
  })
})
