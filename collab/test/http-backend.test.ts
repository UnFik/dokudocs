import { createServer, type IncomingMessage, type Server } from 'node:http'
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { trace } from '@opentelemetry/api'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { HttpBackend } from '../src/http-backend'
import { freePort } from './support'

type Seen = { method: string; url: string; secret: string | undefined; traceparent: string | undefined; body: unknown }

/** A stand-in for the Go internal API, following its contract. */
function fakeGo(port: number, seen: Seen[]): Promise<Server> {
  const documents = new Map<string, { state: string | null; content: unknown }>()
  return new Promise((resolve) => {
    const server = createServer(async (request: IncomingMessage, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(chunk as Buffer)
      const text = Buffer.concat(chunks).toString()
      const body = text ? JSON.parse(text) : undefined
      seen.push({ method: request.method!, url: request.url!, secret: request.headers['x-collab-secret'] as string | undefined, traceparent: request.headers.traceparent as string | undefined, body })
      const send = (status: number, payload?: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(payload === undefined ? undefined : JSON.stringify(payload))
      }
      if (request.headers['x-collab-secret'] !== 'shared') return send(401)
      const url = new URL(request.url!, 'http://x')
      if (url.pathname === '/internal/collab/authorize') {
        if (body.token === 'tok-ok')
          return send(200, { userID: 'user-1', canRead: true, canEdit: true, canSuggest: false })
        return send(403)
      }
      if (url.pathname === '/internal/collab/document') {
        const key = url.searchParams.get('documentID')!
        if (request.method === 'GET') {
          if (key === 'missing') return send(404)
          return send(200, documents.get(key) ?? { state: null, content: null })
        }
        documents.set(key, { state: body.state, content: body.content })
        return send(204)
      }
      send(404)
    })
    server.listen(port, () => resolve(server))
  })
}

describe('HttpBackend against the Go contract', () => {
  let go: Server
  let backend: HttpBackend
  let seen: Seen[]

  beforeEach(async () => {
    seen = []
    const port = await freePort()
    go = await fakeGo(port, seen)
    backend = new HttpBackend(`http://127.0.0.1:${port}`, 'shared')
  })
  afterEach(() => new Promise<void>((resolve) => go.close(() => resolve())))

  it('authorizes a token and sends the shared secret', async () => {
    const result = await backend.authorize('tok-ok', 'ws-1', 'doc-1')
    expect(result).toEqual({ userID: 'user-1', canRead: true, canEdit: true, canSuggest: false })
    expect(seen[0]).toMatchObject({ method: 'POST', secret: 'shared', body: { token: 'tok-ok', workspaceID: 'ws-1', documentID: 'doc-1' } })
  })

  it('treats a refused token as no user', async () => {
    await expect(backend.authorize('tok-bad', 'ws-1', 'doc-1')).resolves.toBeNull()
  })

  it('stores a document and loads it back', async () => {
    await backend.storeState({ workspaceID: 'ws-1', documentID: 'doc-1', state: new Uint8Array([1, 2, 3]), content: { type: 'doc' }, markdown: 'text\n', suggestions: [], updatedBy: null })
    const loaded = await backend.loadDocument('ws-1', 'doc-1')
    expect(Array.from(loaded.state!)).toEqual([1, 2, 3])
    expect(loaded.content).toEqual({ type: 'doc' })
  })

  it('sends the card drawing with an architecture store, and none with a Markdown one', async () => {
    await backend.storeState({ workspaceID: 'ws-1', documentID: 'doc-1', state: new Uint8Array([1]), content: { version: 1 }, markdown: 'System "API".', suggestions: [], updatedBy: null, thumbnail: '<svg></svg>' })
    await backend.storeState({ workspaceID: 'ws-1', documentID: 'doc-2', state: new Uint8Array([1]), content: { type: 'doc' }, markdown: 'text\n', suggestions: [], updatedBy: null })
    const puts = seen.filter((s) => s.method === 'PUT').map((s) => s.body as Record<string, unknown>)
    expect(puts[0]!.thumbnail).toBe('<svg></svg>')
    expect(puts[1]).not.toHaveProperty('thumbnail')
  })

  it('loads a document with nothing stored as nulls, and refuses one that is not there', async () => {
    await expect(backend.loadDocument('ws-1', 'fresh')).resolves.toEqual({ state: null, content: null })
    await expect(backend.loadDocument('ws-1', 'missing')).rejects.toThrow(/not found/i)
  })

  it('fails loudly when the secret is wrong', async () => {
    const wrong = new HttpBackend(`http://127.0.0.1:${(go.address() as { port: number }).port}`, 'nope')
    await expect(wrong.loadDocument('ws-1', 'doc-1')).rejects.toThrow()
  })
})

describe('HttpBackend tracing', () => {
  const spans = new InMemorySpanExporter()
  let go: Server
  let backend: HttpBackend
  let seen: Seen[]

  beforeAll(() => {
    new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] }).register()
  })
  afterAll(() => trace.disable())
  beforeEach(async () => {
    seen = []
    spans.reset()
    const port = await freePort()
    go = await fakeGo(port, seen)
    backend = new HttpBackend(`http://127.0.0.1:${port}`, 'shared')
  })
  afterEach(() => new Promise<void>((resolve) => go.close(() => resolve())))

  it('passes its trace to the API in traceparent, with a span named without the query', async () => {
    await backend.loadDocument('ws-secret-ish', 'doc-1')
    const [span] = spans.getFinishedSpans()
    expect(span?.name).toBe('GET /internal/collab/document')
    expect(JSON.stringify(span?.attributes)).not.toContain('ws-secret-ish')
    expect(seen[0]?.traceparent).toMatch(new RegExp(`^00-${span!.spanContext().traceId}-${span!.spanContext().spanId}-01$`))
  })

  it('records the status the API answered with', async () => {
    await expect(backend.loadDocument('ws-1', 'missing')).rejects.toThrow()
    const [span] = spans.getFinishedSpans()
    expect(span?.attributes['http.response.status_code']).toBe(404)
  })
})
