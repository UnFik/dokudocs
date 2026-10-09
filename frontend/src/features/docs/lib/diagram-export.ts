import { toast } from 'sonner'

/** The rendered DBML or Mermaid preview on screen, as SVG text. */
export function getDiagramSvg(): string | null {
  const svgEl = document.querySelector(
    '#mermaid-canvas-layer svg, [data-preview-layer] svg, svg.pointer-events-none, .dokudocs-preview-svg svg'
  )
  return svgEl ? new XMLSerializer().serializeToString(svgEl) : null
}

const fileName = (title: string, extension: string) =>
  `${title.toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'diagram'}.${extension}`

function download(name: string, href: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

export function copyDiagramSvg() {
  const svgText = getDiagramSvg()
  if (!svgText) {
    toast.error('No rendered diagram found to copy SVG')
    return
  }
  navigator.clipboard.writeText(svgText)
  toast.success('SVG code copied to clipboard')
}

export function exportDiagramSvg(title: string) {
  const svgText = getDiagramSvg()
  if (!svgText) {
    toast.error('No rendered diagram found to export SVG')
    return
  }
  const url = URL.createObjectURL(
    new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })
  )
  download(fileName(title, 'svg'), url)
  URL.revokeObjectURL(url)
  toast.success('SVG diagram downloaded')
}

export function exportDiagramPng(title: string, isDark: boolean) {
  const svgText = getDiagramSvg()
  if (!svgText) {
    toast.error('No rendered diagram found to export PNG')
    return
  }
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const img = new Image()
  const url = URL.createObjectURL(
    new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })
  )
  img.onload = () => {
    const scale = 2
    canvas.width = (img.width || 800) * scale
    canvas.height = (img.height || 600) * scale
    if (ctx) {
      ctx.fillStyle = isDark ? '#09090b' : '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      download(fileName(title, 'png'), canvas.toDataURL('image/png'))
    }
    URL.revokeObjectURL(url)
    toast.success('PNG image downloaded')
  }
  img.src = url
}
