import { trace } from '@opentelemetry/api'
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { log } from '../src/operations'
import { inSpan } from '../src/tracing'

describe('log lines', () => {
  const spans = new InMemorySpanExporter()
  beforeAll(() => {
    new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] }).register()
  })
  afterAll(() => trace.disable())
  afterEach(() => vi.restoreAllMocks())

  const lines = () => {
    const written: Record<string, unknown>[] = []
    vi.spyOn(console, 'log').mockImplementation((text: string) => void written.push(JSON.parse(text)))
    return written
  }

  it('carry the trace of the work they describe, and a level', async () => {
    const written = lines()
    await inSpan('collab store', {}, async () => log('stored', { room: 'w.d' }))
    const [span] = spans.getFinishedSpans()
    expect(written[0]).toMatchObject({ event: 'stored', level: 'INFO', room: 'w.d', trace_id: span!.spanContext().traceId })
  })

  it('mark failures as errors, and carry no trace outside one', () => {
    const written = lines()
    log('store_failed', { room: 'w.d' }, 'ERROR')
    expect(written[0]).toMatchObject({ event: 'store_failed', level: 'ERROR' })
    expect(written[0]).not.toHaveProperty('trace_id')
  })
})
