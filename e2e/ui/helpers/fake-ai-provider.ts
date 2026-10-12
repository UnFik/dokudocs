import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * An OpenAI-compatible Chat Completions server that writes its answer in two
 * parts and waits between them, so a test can look at the screen while the
 * provider is still working. It answers the JSON the Dokudocs answer model asks
 * for: {"answer": "...", "source_ids": ["<first source id>"]}.
 */
export class FakeAIProvider {
  private server!: Server
  private waiting: (() => void)[] = []
  private held = false
  /** Streaming requests currently open. */
  open = 0
  /** Streaming requests that ended before the provider finished its answer. */
  abandoned = 0
  completed = 0
  readonly first = 'The recovery codeword is '
  readonly second = 'cobalt.'

  get url() {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
  }

  async start() {
    this.server = createServer((req, res) => void this.handle(req, res))
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve))
  }

  async stop() {
    this.release()
    this.server.closeAllConnections()
    await new Promise((resolve) => this.server.close(resolve))
  }

  /** From now on, answers stop after their first part until release(). */
  hold() {
    this.held = true
  }

  release() {
    this.held = false
    this.waiting.splice(0).forEach((resume) => resume())
  }

  private async body(req: IncomingMessage) {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    return JSON.parse(Buffer.concat(chunks).toString() || '{}')
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end()
      return
    }
    const request = await this.body(req)
    const user = request.messages?.find((m: { role: string }) => m.role === 'user')
    let sourceID = ''
    try {
      sourceID = JSON.parse(user?.content ?? '{}').sources?.[0]?.id ?? ''
    } catch {
      /* The connection test sends a plain prompt. */
    }
    const json = (answer: string) =>
      JSON.stringify({ answer, source_ids: sourceID ? [sourceID] : [] })
    if (!request.stream) {
      const content = json(this.first + this.second)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
      return
    }
    this.open++
    let finished = false
    res.on('close', () => {
      this.open--
      if (!finished) this.abandoned++
    })
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    const send = (delta: object, finish: string | null = null) =>
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
    const whole = json(this.first + this.second)
    const cut = whole.indexOf(this.second)
    send({ content: whole.slice(0, cut) })
    if (this.held) await new Promise<void>((resolve) => this.waiting.push(resolve))
    if (res.destroyed) return
    send({ content: whole.slice(cut) })
    send({}, 'stop')
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n`)
    res.write('data: [DONE]\n\n')
    finished = true
    this.completed++
    res.end()
  }
}
