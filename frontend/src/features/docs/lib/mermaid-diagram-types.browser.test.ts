import mermaid from 'mermaid'
import { describe, expect, it } from 'vitest'
import { MERMAID_DIAGRAM_TYPES } from './mermaid-diagram-types'
import { getMermaidSuggestions } from './mermaid-intellisense'
import { getAppMermaidConfig } from './mermaid-theme'
import { highlightMermaidCode } from './mermaid-tokenizer'

async function rasterizes(svg: string) {
  const url = URL.createObjectURL(
    new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  )
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('image failed to load'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = 40
    canvas.height = 40
    canvas.getContext('2d')!.drawImage(img, 0, 0)
    canvas.toDataURL('image/png')
    return true
  } catch {
    return false
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Mermaid's swimlane SVG taints a canvas in Chromium for a reason not found
// yet (no foreignObject, filter or external reference in it), so it exports
// as SVG only. This test fails when that changes, as a reminder to drop it.
const SVG_ONLY = new Set(['swimlane-beta'])

describe.each(MERMAID_DIAGRAM_TYPES)('$keyword template', (type) => {
  it.each([false, true])(
    'parses, renders and exports (dark=%s)',
    async (isDark) => {
      mermaid.initialize({
        ...getAppMermaidConfig(isDark),
        securityLevel: 'loose',
      })
      await mermaid.parse(type.template)
      const id = `types-${type.keyword}-${isDark}`
      const { svg } = await mermaid.render(id, type.template)
      expect(svg).toContain('<svg')
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
      expect(await rasterizes(svg)).toBe(!SVG_ONLY.has(type.keyword))
    }
  )

  it('starts with its keyword, which the editor knows', () => {
    expect(type.template.startsWith(type.keyword)).toBe(true)
    const labels = getMermaidSuggestions(
      type.keyword.slice(0, 4),
      4
    ).suggestions
    expect(labels.map((s) => s.label)).toContain(type.keyword)
    expect(highlightMermaidCode(type.template)).toMatch(
      new RegExp(`<span[^>]*>${type.keyword}</span>`)
    )
  })
})
