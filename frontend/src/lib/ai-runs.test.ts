import { jsonResponse, testSession } from '@/test-utils/auth'
import { sseFrame, sseResponse } from '@/test-utils/sse'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { followAIRun, readEventStream, type AIRunEvent } from './ai-runs'

const runID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d'

beforeEach(() => useAuthStore.getState().auth.setSession(testSession()))
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

function streamOf(...chunks: string[]) {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)))
      controller.close()
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const events: AIRunEvent[] = []
  for await (const event of readEventStream(stream)) events.push(event)
  return events
}

describe('readEventStream', () => {
  it('reads events split across chunks, even inside a multi-byte character', async () => {
    const frame = sseFrame(1, 'text_delta', { text: 'Halo 🙂' })
    const bytes = new TextEncoder().encode(frame)
    const cut = frame.indexOf('🙂') + 2
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut))
        controller.enqueue(bytes.slice(cut))
        controller.enqueue(encoder.encode(sseFrame(2, 'completed', {})))
        controller.close()
      },
    })
    const events = await collect(stream)
    expect(events.map((event) => event.id)).toEqual([1, 2])
    expect(events[0]!.data).toEqual({ text: 'Halo 🙂' })
  })

  it('skips heartbeat comments and reads CRLF framing', async () => {
    const events = await collect(
      streamOf(
        ': keep-alive\n\n',
        'id: 3\r\nevent: status\r\ndata: {"phase":"searching"}\r\n\r\n'
      )
    )
    expect(events).toEqual([
      { id: 3, type: 'status', data: { phase: 'searching' } },
    ])
  })
})

describe('followAIRun', () => {
  it('asks again from the last event after the connection drops, without repeating one', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          sseFrame(1, 'text_delta', { text: 'Ha' }),
          sseFrame(2, 'text_delta', { text: 'lo' }),
        ])
      )
      .mockResolvedValueOnce(
        sseResponse([
          // A proxy may replay what was already sent.
          sseFrame(2, 'text_delta', { text: 'lo' }),
          sseFrame(3, 'text_delta', { text: '!' }),
          sseFrame(4, 'completed', { id: runID }),
        ])
      )
    vi.stubGlobal('fetch', fetch)
    const seen: AIRunEvent[] = []
    await followAIRun(runID, {
      signal: new AbortController().signal,
      onEvent: (event) => seen.push(event),
    })
    expect(seen.map((event) => event.id)).toEqual([1, 2, 3, 4])
    const second = fetch.mock.calls[1] as [string, RequestInit]
    expect(new Headers(second[1].headers).get('Last-Event-ID')).toBe('2')
  })

  it('stops at once when the run is refused instead of retrying', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ title: 'AI run not found' }, 404))
    vi.stubGlobal('fetch', fetch)
    await expect(
      followAIRun(runID, {
        signal: new AbortController().signal,
        onEvent: vi.fn(),
      })
    ).rejects.toMatchObject({ status: 404 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('stops quietly when the watcher leaves', async () => {
    const controller = new AbortController()
    const fetch = vi.fn(() => {
      controller.abort()
      return Promise.reject(new DOMException('aborted', 'AbortError'))
    })
    vi.stubGlobal('fetch', fetch)
    await expect(
      followAIRun(runID, { signal: controller.signal, onEvent: vi.fn() })
    ).resolves.toBeUndefined()
  })
})
