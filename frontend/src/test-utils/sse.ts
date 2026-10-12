const encoder = new TextEncoder()

export function sseFrame(id: number, type: string, data: unknown) {
  return `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`
}

/** An event stream the test feeds by hand, so it can look at the screen between events. */
export function controlledStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  return {
    response: () =>
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    send: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  }
}

/** A stream that already holds the given frames and then ends. */
export function sseResponse(frames: string[], status = 200) {
  return new Response(frames.join(''), {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}
