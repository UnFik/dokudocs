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
  private currentRequestedContent: string = ''
  private currentRequestedDark: boolean = false
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

  public requestRender(content: string, isDark: boolean, docId?: string): void {
    if (docId !== undefined && this.lastDocId !== docId) {
      this.pipeline.cancel()
      this.lastDocId = docId
      this.currentRequestedContent = ''
      this.latestValidSvg = ''
      this.state = {
        svg: '',
        error: null,
        isValid: true,
        isRendering: false,
        renderDurationMs: 0,
      }
      this.emitChange()
    }

    const trimmed = content.trim()

    if (!trimmed) {
      this.pipeline.cancel()
      this.currentRequestedContent = ''
      this.latestValidSvg = ''
      if (this.state.svg !== '' || this.state.error !== null || !this.state.isValid || this.state.isRendering) {
        this.state = {
          svg: '',
          error: null,
          isValid: true,
          isRendering: false,
          renderDurationMs: 0,
        }
        this.emitChange()
      }
      return
    }

    if (
      this.currentRequestedContent === trimmed &&
      this.currentRequestedDark === isDark
    ) {
      return
    }

    this.currentRequestedContent = trimmed
    this.currentRequestedDark = isDark

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

        await mermaid.parse(trimmed)

        const renderId = `mermaid-render-${Date.now()}-${++renderCounter}`
        try {
          const { svg: rawSvg } = await mermaid.render(renderId, trimmed)
          const cleanSvg = DOMPurify.sanitize(rawSvg, {
            USE_PROFILES: { svg: true, svgFilters: true },
            ADD_TAGS: ['foreignObject', 'style'],
            ADD_ATTR: ['dominant-baseline', 'text-anchor'],
          })
          return cleanSvg
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
      (err: any) => {
        const rawMsg = err?.message || err?.str || (typeof err === 'string' ? err : 'Invalid Mermaid syntax')
        const errorMsg = String(rawMsg).replace(/^Error:\s*/i, '').trim()
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

export function useMermaidRender(content: string, isDark: boolean, docId?: string): MermaidRenderResult {
  renderStore.requestRender(content, isDark, docId)
  return useSyncExternalStore(renderStore.subscribe, renderStore.getSnapshot)
}
