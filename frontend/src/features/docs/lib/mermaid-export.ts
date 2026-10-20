import { renderMermaidSvgDirect } from '../hooks/use-mermaid-render'

const SVG_NS = 'http://www.w3.org/2000/svg'

export interface ExportSvgOptions {
  isDark: boolean
  themeName: string
  /** A CSS colour, or `transparent`. */
  background: string
}

async function embeddedFontCss(): Promise<string> {
  const { default: inter } =
    await import('@/assets/fonts/inter-latin.woff2?inline')
  return `@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;src:url(${inter}) format('woff2');}`
}

/**
 * The diagram as an SVG file that opens correctly on its own: sized from its
 * viewBox, the background drawn in, and Inter embedded so text does not fall
 * back to whatever font the viewer has.
 */
export async function buildStandaloneSvg(
  rendered: string,
  { background }: Pick<ExportSvgOptions, 'background'>
): Promise<string> {
  const doc = new DOMParser().parseFromString(rendered, 'image/svg+xml')
  const svg = doc.documentElement
  if (svg.localName !== 'svg' || doc.querySelector('parsererror')) {
    throw new Error('The diagram SVG could not be read')
  }
  svg.setAttribute('xmlns', SVG_NS)
  svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')

  const box = svg
    .getAttribute('viewBox')
    ?.split(/[\s,]+/)
    .map(Number)
  if (box?.length === 4 && box[2] > 0 && box[3] > 0) {
    svg.setAttribute('width', String(Math.ceil(box[2])))
    svg.setAttribute('height', String(Math.ceil(box[3])))
  }
  svg.removeAttribute('style')

  const style = doc.createElementNS(SVG_NS, 'style')
  style.textContent = await embeddedFontCss()
  svg.insertBefore(style, svg.firstChild)

  if (background !== 'transparent') {
    const rect = doc.createElementNS(SVG_NS, 'rect')
    rect.setAttribute('width', '100%')
    rect.setAttribute('height', '100%')
    rect.setAttribute('fill', background)
    svg.insertBefore(rect, style.nextSibling)
  }
  return new XMLSerializer().serializeToString(svg)
}

/** Renders the source with `mermaid.render` and returns the standalone SVG. Throws on bad syntax. */
export async function renderExportSvg(
  content: string,
  options: ExportSvgOptions
): Promise<string> {
  const rendered = await renderMermaidSvgDirect(
    content,
    options.isDark,
    options.themeName,
    { plainLabels: true }
  )
  return buildStandaloneSvg(rendered, options)
}

/** Draws a standalone SVG onto a canvas at `scale` times its own size. */
export async function rasterizeSvg(
  svg: string,
  scale: number
): Promise<HTMLCanvasElement> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () =>
        reject(new Error('This diagram cannot be exported as an image'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round((img.naturalWidth || 800) * scale))
    canvas.height = Math.max(1, Math.round((img.naturalHeight || 600) * scale))
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    // Reading the pixels throws when the picture tainted the canvas.
    canvas.toDataURL('image/png')
    return canvas
  } catch (error) {
    throw error instanceof Error && error.name !== 'SecurityError'
      ? error
      : new Error('This diagram cannot be exported as an image')
  } finally {
    URL.revokeObjectURL(url)
  }
}
