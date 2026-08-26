export interface RenderPipelineConfig {
  minDelayMs?: number
  maxDelayMs?: number
  fastThresholdMs?: number
  slowThresholdMs?: number
}

export class AdaptiveRenderGater {
  private minDelay: number
  private maxDelay: number
  private fastThreshold: number
  private slowThreshold: number
  private lastRenderDurationMs: number = 0
  private currentDebounceDelay: number

  constructor(config?: RenderPipelineConfig) {
    this.minDelay = config?.minDelayMs ?? 50
    this.maxDelay = config?.maxDelayMs ?? 800
    this.fastThreshold = config?.fastThresholdMs ?? 100
    this.slowThreshold = config?.slowThresholdMs ?? 250
    this.currentDebounceDelay = this.minDelay
  }

  public recordRenderTime(durationMs: number): void {
    this.lastRenderDurationMs = Math.max(0, durationMs)

    if (this.lastRenderDurationMs <= this.fastThreshold) {
      this.currentDebounceDelay = this.minDelay
    } else if (this.lastRenderDurationMs <= this.slowThreshold) {
      this.currentDebounceDelay = 150
    } else {
      const scaled = Math.round(this.lastRenderDurationMs * 1.5)
      this.currentDebounceDelay = Math.min(this.maxDelay, Math.max(250, scaled))
    }
  }

  public getDelay(): number {
    return this.currentDebounceDelay
  }

  public getLastDuration(): number {
    return this.lastRenderDurationMs
  }
}

export class AsyncRenderPipeline<TResult> {
  private latestSequence: number = 0
  private gater: AdaptiveRenderGater
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(gater?: AdaptiveRenderGater) {
    this.gater = gater ?? new AdaptiveRenderGater()
  }

  public schedule(
    renderFn: () => Promise<TResult>,
    onSuccess: (result: TResult, durationMs: number) => void,
    onError: (error: any) => void,
    onPending?: () => void
  ): () => void {
    this.cancel()
    const seq = ++this.latestSequence
    const delay = this.gater.getDelay()

    this.timer = setTimeout(async () => {
      if (seq !== this.latestSequence) return
      onPending?.()

      const startTime = performance.now()
      try {
        const result = await renderFn()
        if (seq !== this.latestSequence) return
        const duration = performance.now() - startTime
        this.gater.recordRenderTime(duration)
        onSuccess(result, duration)
      } catch (err) {
        if (seq !== this.latestSequence) return
        onError(err)
      }
    }, delay)

    return () => {
      if (this.latestSequence === seq) {
        this.cancel()
      }
    }
  }

  public cancel(): void {
    this.latestSequence++
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  public getGater(): AdaptiveRenderGater {
    return this.gater
  }
}
