import { context, propagation, SpanKind, SpanStatusCode, trace, type Attributes, type Span } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'

const tracer = () => trace.getTracer('collab')

/**
 * Installs tracing for the service. Spans are exported over OTLP when an
 * endpoint is set (e.g. http://alloy:4318); without one, nothing is recorded.
 */
export function startTracing(endpoint: string | null): () => Promise<void> {
  if (!endpoint) return async () => {}
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ 'service.name': 'collab' }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }))],
  })
  // Registers the W3C traceparent propagator and keeps the active span across awaits.
  provider.register()
  return () => provider.shutdown()
}

/**
 * Runs fn inside a new span, which ends with fn and is marked failed if fn
 * rejects. It returns fn's own promise, adding no step before the caller sees
 * the result: Hocuspocus unloads a dropped room only if its store has settled
 * by the time the connections close.
 */
export function inSpan<T>(name: string, attributes: Attributes, fn: (span: Span) => Promise<T>, kind = SpanKind.INTERNAL): Promise<T> {
  return tracer().startActiveSpan(name, { attributes, kind }, (span) => {
    const result = fn(span)
    result.then(
      () => span.end(),
      (error: unknown) => {
        span.recordException(error as Error)
        span.setStatus({ code: SpanStatusCode.ERROR })
        span.end()
      }
    )
    return result
  })
}

/** Headers that carry the active trace to another service. */
export function traceHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  propagation.inject(context.active(), headers)
  return headers
}

/** The active trace's ID, for log lines. */
export function activeTraceID(): string | undefined {
  const span = trace.getActiveSpan()?.spanContext()
  return span && trace.isSpanContextValid(span) ? span.traceId : undefined
}
