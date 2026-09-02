import { useSyncExternalStore } from 'react'
import DOMPurify from 'dompurify'
import mermaid from 'mermaid'
import { AsyncRenderPipeline } from '../lib/live-render-pipeline'

export interface MermaidRenderResult {
  svg: string
  error: string | null
  isValid: boolean
  isRendering: boolean
  renderDurationMs: number
}

let renderCounter = 0

function parseColorToRgb(
  colorStr: string
): { r: number; g: number; b: number } | null {
  const trimmed = colorStr.trim()
  if (trimmed.startsWith('#')) {
    let hex = trimmed.slice(1)
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map((c) => c + c)
        .join('')
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16),
      }
    }
  }

  const rgbMatch = trimmed.match(
    /^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)$/i
  )
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10),
      g: parseInt(rgbMatch[2], 10),
      b: parseInt(rgbMatch[3], 10),
    }
  }

  const namedColors: Record<string, { r: number; g: number; b: number }> = {
    white: { r: 255, g: 255, b: 255 },
    ivory: { r: 255, g: 255, b: 240 },
    lightyellow: { r: 255, g: 255, b: 224 },
    yellow: { r: 255, g: 255, b: 0 },
    lightgreen: { r: 144, g: 238, b: 144 },
    palegreen: { r: 152, g: 251, b: 152 },
    mintcream: { r: 245, g: 255, b: 250 },
    honeydew: { r: 240, g: 255, b: 240 },
    aliceblue: { r: 240, g: 248, b: 255 },
    azure: { r: 240, g: 255, b: 255 },
    ghostwhite: { r: 248, g: 248, b: 255 },
    whitesmoke: { r: 245, g: 245, b: 245 },
    seashell: { r: 255, g: 245, b: 238 },
    beige: { r: 245, g: 245, b: 220 },
    lightgray: { r: 211, g: 211, b: 211 },
    lightgrey: { r: 211, g: 211, b: 211 },
  }

  return namedColors[trimmed.toLowerCase()] || null
}

export function enhanceMermaidSvgForDarkMode(
  svg: string,
  isDark: boolean
): string {
  if (!isDark) return svg

  let result = svg.replace(
    /<rect([^>]*?)fill=(["'])([^"']+)\2([^>]*?)>/gi,
    (fullMatch, pre, _quote, fillValue, post) => {
      const parsed = parseColorToRgb(fillValue)
      if (!parsed) return fullMatch

      const luminance =
        (parsed.r * 299 + parsed.g * 587 + parsed.b * 114) / 1000
      if (luminance > 85) {
        const darkR = Math.max(14, Math.min(55, Math.round(parsed.r * 0.16)))
        const darkG = Math.max(14, Math.min(55, Math.round(parsed.g * 0.16)))
        const darkB = Math.max(14, Math.min(55, Math.round(parsed.b * 0.16)))
        const strokeR = Math.min(255, Math.round(parsed.r * 0.75))
        const strokeG = Math.min(255, Math.round(parsed.g * 0.75))
        const strokeB = Math.min(255, Math.round(parsed.b * 0.75))

        let updated =
          pre +
          `fill="rgb(${darkR}, ${darkG}, ${darkB})" fill-opacity="0.88"` +
          post
        if (!updated.includes('stroke=')) {
          updated += ` stroke="rgba(${strokeR}, ${strokeG}, ${strokeB}, 0.45)" stroke-width="1.2"`
        }
        return `<rect${updated}>`
      }
      return fullMatch
    }
  )

  result = result.replace(
    /<rect([^>]*?)style=(["'])([^"']*?)fill:\s*([^;"]+)(;?[^"']*?)\2([^>]*?)>/gi,
    (fullMatch, pre, _quote, stylePre, fillValue, stylePost, post) => {
      const parsed = parseColorToRgb(fillValue)
      if (!parsed) return fullMatch

      const luminance =
        (parsed.r * 299 + parsed.g * 587 + parsed.b * 114) / 1000
      if (luminance > 85) {
        const darkR = Math.max(14, Math.min(55, Math.round(parsed.r * 0.16)))
        const darkG = Math.max(14, Math.min(55, Math.round(parsed.g * 0.16)))
        const darkB = Math.max(14, Math.min(55, Math.round(parsed.b * 0.16)))
        const strokeR = Math.min(255, Math.round(parsed.r * 0.75))
        const strokeG = Math.min(255, Math.round(parsed.g * 0.75))
        const strokeB = Math.min(255, Math.round(parsed.b * 0.75))

        const newStyle = `${stylePre}fill: rgb(${darkR}, ${darkG}, ${darkB}); fill-opacity: 0.88; stroke: rgba(${strokeR}, ${strokeG}, ${strokeB}, 0.45); stroke-width: 1.2px${stylePost}`
        return `<rect${pre}style="${newStyle}"${post}>`
      }
      return fullMatch
    }
  )

  return result
}

export function getMermaidConfig(isDark: boolean, themeName: string = 'default') {
  if (themeName === 'neutral') {
    return {
      startOnLoad: false,
      theme: 'neutral' as const,
      securityLevel: 'loose' as const,
      fontFamily:
        'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      suppressErrorRendering: true,
      logLevel: 'fatal' as const,
    }
  }

  if (themeName === 'forest') {
    return {
      startOnLoad: false,
      theme: 'forest' as const,
      securityLevel: 'loose' as const,
      fontFamily:
        'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      suppressErrorRendering: true,
      logLevel: 'fatal' as const,
    }
  }

  if (!isDark) {
    return {
      startOnLoad: false,
      theme: 'default' as const,
      securityLevel: 'loose' as const,
      fontFamily:
        'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      suppressErrorRendering: true,
      logLevel: 'fatal' as const,
    }
  }

  return {
    startOnLoad: false,
    theme: 'dark' as const,
    securityLevel: 'loose' as const,
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    suppressErrorRendering: true,
    logLevel: 'fatal' as const,
    themeVariables: {
      darkMode: true,
      background: 'transparent',
      primaryColor: '#1e1b4b',
      primaryTextColor: '#f8fafc',
      primaryBorderColor: '#818cf8',
      lineColor: '#cbd5e1',
      secondaryColor: '#831843',
      secondaryTextColor: '#fdf2f8',
      secondaryBorderColor: '#f472b6',
      tertiaryColor: '#064e3b',
      tertiaryTextColor: '#ecfdf5',
      tertiaryBorderColor: '#34d399',
      mainBkg: '#18181b',
      nodeBorder: '#818cf8',
      clusterBkg: '#09090b',
      clusterBorder: '#3f3f46',
      defaultLinkColor: '#cbd5e1',
      titleColor: '#f8fafc',
      edgeLabelBackground: '#18181b',
      actorBkg: '#1e1b4b',
      actorBorder: '#818cf8',
      actorTextColor: '#f8fafc',
      actorLineColor: '#818cf8',
      signalColor: '#f8fafc',
      signalTextColor: '#ffffff',
      labelBoxBkgColor: '#18181b',
      labelBoxBorderColor: '#6366f1',
      labelTextColor: '#f8fafc',
      loopTextColor: '#f8fafc',
      noteBkgColor: '#36300a',
      noteBorderColor: '#854d0e',
      noteTextColor: '#fef08a',
      activationBkgColor: '#312e81',
      activationBorderColor: '#a5b4fc',
      sequenceNumberColor: '#ffffff',
      cScale0: '#8b5cf6',
      cScale1: '#10b981',
      cScale2: '#f97316',
      cScale3: '#06b6d4',
      cScale4: '#ec4899',
      cScale5: '#eab308',
      cScale6: '#14b8a6',
      cScale7: '#6366f1',
    },
  }
}

export async function renderMermaidSvgDirect(
  code: string,
  isDark: boolean,
  themeName: string = 'default'
): Promise<string> {
  const config = getMermaidConfig(isDark, themeName)
  mermaid.initialize(config)
  const renderId = `mermaid-export-${Date.now()}-${++renderCounter}`
  try {
    const { svg: rawSvg } = await mermaid.render(renderId, code)
    const cleanSvg = DOMPurify.sanitize(rawSvg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ADD_TAGS: ['foreignObject', 'style'],
      ADD_ATTR: ['dominant-baseline', 'text-anchor'],
    })
    const normalizedSvg = cleanSvg
      .replace(/max-width:\s*[\d.]+px;?/gi, 'max-width: 100%;')
      .replace(/style="([^"]*)"/i, (_match, p1) => {
        const updated = p1.replace(/max-width:\s*[\d.]+px;?/gi, 'max-width: 100%;')
        return `style="${updated}"`
      })
    return enhanceMermaidSvgForDarkMode(normalizedSvg, isDark)
  } finally {
    const errorElement = document.getElementById(renderId)
    if (errorElement) errorElement.remove()
    const errorD = document.getElementById(`d${renderId}`)
    if (errorD) errorD.remove()
  }
}

class MermaidRenderStore {
  private state: MermaidRenderResult = {
    svg: '',
    error: null,
    isValid: true,
    isRendering: false,
    renderDurationMs: 0,
  }
  private listeners = new Set<() => void>()
  private pipeline = new AsyncRenderPipeline<string>()
  private currentRequestedContent: string = ''
  private currentRequestedDark: boolean = false
  private currentRequestedTheme: string = 'default'
  private latestValidSvg: string = ''
  private lastDocId?: string

  constructor() {
    this.subscribe = this.subscribe.bind(this)
    this.getSnapshot = this.getSnapshot.bind(this)
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public getSnapshot(): MermaidRenderResult {
    return this.state
  }

  private emitChange(): void {
    this.listeners.forEach((listener) => listener())
  }

  public requestRender(
    content: string,
    isDark: boolean,
    docId?: string,
    themeName: string = 'default'
  ): void {
    if (docId !== undefined && this.lastDocId !== docId) {
      this.lastDocId = docId
      this.currentRequestedContent = ''
    }

    const trimmed = content.trim()

    if (!trimmed) {
      this.pipeline.cancel()
      this.currentRequestedContent = ''
      this.latestValidSvg = ''
      if (
        this.state.svg !== '' ||
        this.state.error !== null ||
        !this.state.isValid ||
        this.state.isRendering
      ) {
        this.state = {
          svg: '',
          error: null,
          isValid: true,
          isRendering: false,
          renderDurationMs: 0,
        }
      }
      return
    }

    if (
      this.currentRequestedContent === trimmed &&
      this.currentRequestedDark === isDark &&
      this.currentRequestedTheme === themeName
    ) {
      return
    }

    this.currentRequestedContent = trimmed
    this.currentRequestedDark = isDark
    this.currentRequestedTheme = themeName

    this.pipeline.schedule(
      async () => {
        mermaid.initialize(getMermaidConfig(isDark, themeName))

        await mermaid.parse(trimmed)

        const renderId = `mermaid-render-${Date.now()}-${++renderCounter}`
        try {
          const { svg: rawSvg } = await mermaid.render(renderId, trimmed)
          const cleanSvg = DOMPurify.sanitize(rawSvg, {
            USE_PROFILES: { svg: true, svgFilters: true },
            ADD_TAGS: ['foreignObject', 'style'],
            ADD_ATTR: ['dominant-baseline', 'text-anchor'],
          })
          const normalizedSvg = cleanSvg
            .replace(/max-width:\s*[\d.]+px;?/gi, 'max-width: 100%;')
            .replace(/style="([^"]*)"/i, (_match, p1) => {
              const updated = p1.replace(/max-width:\s*[\d.]+px;?/gi, 'max-width: 100%;')
              return `style="${updated}"`
            })
          return enhanceMermaidSvgForDarkMode(normalizedSvg, isDark)
        } finally {
          const errorElement = document.getElementById(renderId)
          if (errorElement) {
            errorElement.remove()
          }
          const errorD = document.getElementById(`d${renderId}`)
          if (errorD) {
            errorD.remove()
          }
        }
      },
      (cleanSvg, durationMs) => {
        this.latestValidSvg = cleanSvg
        this.state = {
          svg: cleanSvg,
          error: null,
          isValid: true,
          isRendering: false,
          renderDurationMs: durationMs,
        }
        this.emitChange()
      },
      (err: unknown) => {
        const errorRecord = err as Record<string, unknown> | null | undefined
        const rawMsg =
          (typeof err === 'object' && err !== null && 'message' in err
            ? String(errorRecord?.message)
            : typeof err === 'object' && err !== null && 'str' in err
              ? String(errorRecord?.str)
              : typeof err === 'string'
                ? err
                : 'Invalid Mermaid syntax')
        const errorMsg = String(rawMsg)
          .replace(/^Error:\s*/i, '')
          .trim()
        this.state = {
          svg: this.latestValidSvg,
          error: errorMsg || 'Invalid Mermaid syntax',
          isValid: false,
          isRendering: false,
          renderDurationMs: this.state.renderDurationMs,
        }
        this.emitChange()
      },
      () => {
        if (!this.state.isRendering) {
          this.state = {
            ...this.state,
            isRendering: true,
          }
          this.emitChange()
        }
      }
    )
  }
}

const renderStore = new MermaidRenderStore()

export function useMermaidRender(
  content: string,
  isDark: boolean,
  docId?: string,
  themeName: string = 'default'
): MermaidRenderResult {
  renderStore.requestRender(content, isDark, docId, themeName)
  return useSyncExternalStore(renderStore.subscribe, renderStore.getSnapshot)
}
