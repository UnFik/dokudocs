import { describe, expect, it } from 'vitest'
import { rasterizeSvg, renderExportSvg } from './mermaid-export'

const diagrams: Record<string, string> = {
  flowchart: 'flowchart LR\n A[Start] --> B{Ok?}\n B --> C[Done]',
  sequence: 'sequenceDiagram\n A->>B: hi\n B-->>A: yo',
  state: 'stateDiagram-v2\n [*] --> On\n On --> [*]',
  er: 'erDiagram\n USER ||--o{ POST : writes',
  gantt:
    'gantt\n title Plan\n dateFormat YYYY-MM-DD\n section S\n Task :a1, 2026-01-01, 3d',
  class: 'classDiagram\n class Animal\n Animal : +name',
  mindmap: 'mindmap\n  root((Docs))\n    Mermaid\n    DBML',
}

describe.each([false, true])('standalone export (dark=%s)', (isDark) => {
  it.each(Object.entries(diagrams))(
    '%s opens on its own and rasterizes',
    async (_name, code) => {
      const svg = await renderExportSvg(code, {
        isDark,
        themeName: 'default',
        background: isDark ? '#0f1114' : 'transparent',
      })
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
      expect(svg).toContain('@font-face')
      expect(svg).toMatch(/<svg[^>]*\swidth="\d+"/)
      if (isDark) expect(svg).toContain('fill="#0f1114"')
      const canvas = await rasterizeSvg(svg, 2)
      expect(canvas.width).toBeGreaterThan(0)
      expect(canvas.height).toBeGreaterThan(0)
    }
  )
})

describe('diagrams Mermaid draws with HTML labels', () => {
  it('still exports SVG, and says plainly that PNG is not possible', async () => {
    const svg = await renderExportSvg(
      'journey\n  title Day\n  section Work\n    Code: 5: Me',
      { isDark: false, themeName: 'default', background: 'transparent' }
    )
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    await expect(rasterizeSvg(svg, 1)).rejects.toThrow(
      'cannot be exported as an image'
    )
  })
})

describe('invalid source', () => {
  it('rejects so the export stays disabled', async () => {
    await expect(
      renderExportSvg('flowchart LR\n A --> ', {
        isDark: false,
        themeName: 'default',
        background: 'transparent',
      })
    ).rejects.toBeDefined()
  })
})
