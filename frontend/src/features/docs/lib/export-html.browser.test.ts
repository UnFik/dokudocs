import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildExportHtml } from './export-html'

const { assetObjectURL } = vi.hoisted(() => ({ assetObjectURL: vi.fn() }))
vi.mock('./assets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./assets')>()),
  assetObjectURL,
}))

beforeEach(() => {
  assetObjectURL.mockReset()
})

const workspaceID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'

/** The exported fragment, parsed the way the converter's browser will parse it. */
async function exported(markdown: string) {
  const host = document.createElement('div')
  host.innerHTML = await buildExportHtml(markdown, { workspaceID })
  return host
}

describe('buildExportHtml', () => {
  it('holds the document in an article with its own styles and nothing that runs', async () => {
    const host = await exported('# Title\n\nHello **world**')

    const article = host.querySelector('article.markdown-body')!
    expect(article.querySelector('h1')?.textContent).toBe('Title')
    expect(article.querySelector('strong')?.textContent).toBe('world')
    expect(host.querySelector('style')?.textContent?.length).toBeGreaterThan(
      500
    )
    expect(host.querySelector('script')).toBeNull()
  })

  it('opens every toggle, so what is folded in the editor is on the page', async () => {
    const host = await exported('+++\nTitle line\nHidden body\n+++\n\nafter')

    const toggle = host.querySelector('details')!
    expect(toggle.hasAttribute('open')).toBe(true)
    expect(toggle.textContent).toContain('Hidden body')
  })

  it('keeps an explicit page break for the print stylesheet to act on', async () => {
    const host = await exported('one\n\n<div class="page-break"></div>\n\ntwo')

    expect(host.querySelector('.page-break')).not.toBeNull()
    expect(host.querySelector('style')?.textContent).toMatch(
      /\.page-break\s*\{[^}]*break-after:\s*page/
    )
  })

  describe('images', () => {
    // A 1x1 transparent PNG.
    const png = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
      ),
      (c) => c.charCodeAt(0)
    )

    it('puts a stored image on the page itself, as a data: address', async () => {
      assetObjectURL.mockResolvedValue(
        URL.createObjectURL(new Blob([png], { type: 'image/png' }))
      )

      const host = await exported('![diagram](/api/v1/documents/d1/assets/a1)')

      const image = host.querySelector('img')!
      expect(image.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
      expect(image.getAttribute('alt')).toBe('diagram')
      expect(assetObjectURL).toHaveBeenCalledWith(
        workspaceID,
        '/api/v1/documents/d1/assets/a1'
      )
    })

    it('puts the alt text where a stored image could not be fetched', async () => {
      assetObjectURL.mockRejectedValue(new Error('gone'))

      const host = await exported(
        'before ![the diagram](/api/v1/documents/d1/assets/a1) after'
      )

      expect(host.querySelector('img')).toBeNull()
      expect(host.querySelector('article')?.textContent).toContain(
        'before the diagram after'
      )
    })

    it('puts the alt text where an image lives on another host, as the page may load nothing', async () => {
      const host = await exported('![chart](https://example.com/chart.png)')

      expect(host.querySelector('img')).toBeNull()
      expect(host.innerHTML).not.toContain('example.com')
      expect(host.querySelector('article')?.textContent).toContain('chart')
      expect(assetObjectURL).not.toHaveBeenCalled()
    })

    it('does not ask the server for an image just by reading the page', async () => {
      assetObjectURL.mockRejectedValue(new Error('gone'))
      const address = `${location.origin}/api/v1/documents/d1/assets/probe-unrequested`

      await exported('![x](/api/v1/documents/d1/assets/probe-unrequested)')
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(performance.getEntriesByName(address)).toHaveLength(0)
    })

    it('leaves an image that already is a data: address alone', async () => {
      const src = 'data:image/png;base64,AAAA'

      const host = await exported(`![inline](${src})`)

      expect(host.querySelector('img')?.getAttribute('src')).toBe(src)
    })
  })

  it('draws a Mermaid diagram onto the page in the light theme, even when the app is dark', async () => {
    document.documentElement.classList.add('dark')
    try {
      const host = await exported(
        '```mermaid\ngraph TD\n  A[Start] --> B[End]\n```'
      )

      expect(host.querySelector('.dd-diagram svg')).not.toBeNull()
      expect(host.textContent).toContain('Start')
      // The dark theme's own colors (theme.css, dark) must not be in what is printed.
      const printed = host.innerHTML.toLowerCase()
      expect(printed).not.toContain('#171a1f')
      expect(printed).not.toContain('#e6e8eb')
    } finally {
      document.documentElement.classList.remove('dark')
    }
  })

  it('keeps the labels of a diagram but nothing that runs inside them', async () => {
    const host = await exported(
      '```mermaid\ngraph TD\n  A["<img src=x onerror=alert(1)>Danger"] --> B[End]\n```'
    )

    expect(host.textContent).toContain('End')
    // The text may show as text; nothing in the page may be able to run.
    expect(host.querySelector('script, img, [onerror], [onload]')).toBeNull()
  })

  it('carries the formula fonts as data: addresses, and only when the document has a formula', async () => {
    const plain = await buildExportHtml('no formula here', { workspaceID })
    expect(plain).not.toContain('@font-face')

    const withFormula = await buildExportHtml('Inline $E = mc^2$ and more', {
      workspaceID,
    })

    expect(withFormula).toContain('@font-face')
    expect(withFormula).toContain('.katex')
    // The page may load nothing: every url() in it is already the file itself.
    const addresses = [...withFormula.matchAll(/url\(([^)]*)\)/g)].map(
      (match) => match[1]!.replace(/["']/g, '')
    )
    expect(addresses.length).toBeGreaterThan(0)
    expect(addresses.filter((address) => !address.startsWith('data:'))).toEqual(
      []
    )
  })

  it('stands alone: white page, dark text and the notice colors, whatever theme the app is in', async () => {
    document.documentElement.classList.add('dark')
    const frame = document.createElement('iframe')
    try {
      const fragment = await buildExportHtml(
        '# Title\n\n:::warning\nCareful\n:::',
        { workspaceID }
      )
      // A document of its own, with none of the app's stylesheets, as the converter has.
      const loaded = new Promise((resolve) => (frame.onload = resolve))
      frame.srcdoc = `<!doctype html><html><head></head><body>${fragment}</body></html>`
      document.body.append(frame)
      await loaded
      const page = frame.contentWindow!
      const style = (selector: string) =>
        page.getComputedStyle(page.document.querySelector(selector)!)

      expect(style('body').backgroundColor).toBe('rgb(255, 255, 255)')
      expect(style('h1').color).toBe('rgb(31, 35, 40)')
      expect(style('.dd-notice').backgroundColor).toBe('rgb(246, 248, 250)')
      expect(style('.dd-notice-warning').borderLeftColor).toBe(
        'rgb(180, 83, 9)'
      )
    } finally {
      frame.remove()
      document.documentElement.classList.remove('dark')
    }
  })

  it('draws diagram labels as SVG text, which the converter cannot clip to the width Mermaid measured', async () => {
    const host = await exported(
      '```mermaid\ngraph TD\n  A[Mulai] --> B[Selesai]\n```'
    )

    // HTML labels sit in a box as wide as the reader's font made them; the converter
    // draws with other fonts, and the last letter of "Mulai" came out as "Mula".
    expect(host.querySelector('foreignObject')).toBeNull()
    const labels = [...host.querySelectorAll('svg text')].map(
      (text) => text.textContent
    )
    expect(labels.join(' ')).toContain('Mulai')
    expect(labels.join(' ')).toContain('Selesai')
  })
})
