import { describe, expect, it } from 'vitest'
import { markdownToDocumentJSON } from './markdown-to-document-json'

type JSONNode = {
  type: string
  text?: string
  marks?: { type: string }[]
  content?: JSONNode[]
  attrs?: Record<string, unknown>
}

function collect(node: JSONNode, out: JSONNode[] = []) {
  out.push(node)
  for (const child of node.content ?? []) collect(child, out)
  return out
}

describe('markdownToDocumentJSON', () => {
  it('turns Markdown into the editor document: headings, text and marks', async () => {
    const json = (await markdownToDocumentJSON(
      '# Title\n\nhello **bold** world'
    )) as JSONNode
    const nodes = collect(json)

    expect(json.type).toBe('doc')
    expect(nodes.some((node) => node.type === 'atx_heading')).toBe(true)
    const bold = nodes.find((node) => node.text === 'bold')
    expect(bold?.marks?.map((mark) => mark.type)).toEqual(['strong'])
    expect(nodes.find((node) => node.text === 'Title')).toBeDefined()
  })

  it('gives a document with no text for empty Markdown', async () => {
    const json = (await markdownToDocumentJSON('')) as JSONNode
    expect(json.type).toBe('doc')
    expect(collect(json).some((node) => node.text)).toBe(false)
  })
})
