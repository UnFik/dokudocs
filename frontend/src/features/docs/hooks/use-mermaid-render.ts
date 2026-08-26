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
  private lastRenderedContent: string = ''
  private lastRenderedDark: boolean = false
  private latestValidSvg: string = ''

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

  public requestRender(content: string, isDark: boolean): void {
    const trimmed = content.trim()

    if (!trimmed) {
      this.pipeline.cancel()
      this.lastRenderedContent = ''
      this.latestValidSvg = ''
      this.state = {
        svg: '',
        error: null,
        isValid: true,
        isRendering: false,
        renderDurationMs: 0,
      }
      this.emitChange()
      return
    }

    if (this.lastRenderedContent === trimmed && this.lastRenderedDark === isDark) {
      return
    }

    this.pipeline.schedule(
      async () => {
        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? 'dark' : 'default',
          securityLevel: 'loose',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          suppressErrorRendering: true,
          logLevel: 'fatal',
        })

        const renderId = `mermaid-render-${Date.now()}-${++renderCounter}`
        try {
          const { svg: rawSvg } = await mermaid.render(renderId, trimmed)
          const cleanSvg = DOMPurify.sanitize(rawSvg, {
            USE_PROFILES: { svg: true, svgFilters: true },
            ADD_TAGS: ['foreignObject', 'style'],
            ADD_ATTR: ['dominant-baseline', 'text-anchor'],
          })
          return cleanSvg
        } catch (err: any) {
          const errorElement = document.getElementById(renderId)
          if (errorElement) {
            errorElement.remove()
          }
          const errorD = document.getElementById(`d${renderId}`)
          if (errorD) {
            errorD.remove()
          }
          throw err
        }
      },
      (cleanSvg, durationMs) => {
        this.lastRenderedContent = trimmed
        this.lastRenderedDark = isDark
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
      (err: any) => {
        const errorMsg = err?.message || 'Invalid Mermaid syntax'
        this.state = {
          svg: this.latestValidSvg,
          error: errorMsg,
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

export function useMermaidRender(content: string, isDark: boolean): MermaidRenderResult {
  renderStore.requestRender(content, isDark)
  return useSyncExternalStore(renderStore.subscribe, renderStore.getSnapshot)
}
