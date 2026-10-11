import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Hocuspocus } from '@hocuspocus/server'
import { Node } from 'prosemirror-model'
import * as Y from 'yjs'
import { updateYFragment, yDocToProsemirrorJSON } from 'y-prosemirror'
import { randomUUID } from 'node:crypto'
import {
  AgentEditError,
  applyMarkdownOperations,
  applySourceOperations,
  textVersion,
  type MarkdownOperation,
  type SourceOperation,
} from './agent-edit'
import { isSourceType, type DocumentType } from './backend-api'
import { toMarkdown } from './markdown'
import { parseRoom } from './room'
import { documentBodySchema } from './schema'
import { sourceName } from './source'
import { validateSuggesterChange } from './suggestion-validator'

const fragmentName = 'body'
const maxBodyBytes = 1 << 20

type EditRequest = {
  room?: string
  type?: string
  userID?: string
  mode?: string
  baseVersion?: string
  operations?: unknown
}

function send(response: ServerResponse, status: number, body?: unknown) {
  response.writeHead(status, body === undefined ? {} : { 'content-type': 'application/json' })
  response.end(body === undefined ? undefined : JSON.stringify(body))
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBodyBytes) reject(new AgentEditError('the request is too large'))
      else chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

const editable = (type: string): type is DocumentType => type === 'markdown' || type === 'dbdiagram' || type === 'mermaid'

/** The text the Agent reads, from the room's live state. */
function liveText(doc: Y.Doc, type: DocumentType): string {
  return isSourceType(type) ? doc.getText(sourceName).toString() : toMarkdown(yDocToProsemirrorJSON(doc, fragmentName))
}

/** Rewrites a shared text with the smallest change, so a cursor elsewhere stays put. */
function replaceSource(text: Y.Text, next: string) {
  const current = text.toString()
  let start = 0
  while (start < current.length && start < next.length && current[start] === next[start]) start++
  let end = 0
  while (end < current.length - start && end < next.length - start && current[current.length - 1 - end] === next[next.length - 1 - end]) end++
  text.delete(start, current.length - start - end)
  text.insert(start, next.slice(start, next.length - end))
}

/**
 * `/internal/agent-read` and `/internal/agent-edit`: the API reads and edits a room
 * for the Agent (ADR 0043). The API has already decided the mode from the User's
 * rights; a suggestion is still checked as a person's would be.
 */
export async function handleAgentRequest(url: URL, request: IncomingMessage, response: ServerResponse, instance: Hocuspocus): Promise<boolean> {
  const isRead = url.pathname === '/internal/agent-read' && request.method === 'GET'
  const isEdit = url.pathname === '/internal/agent-edit' && request.method === 'POST'
  if (!isRead && !isEdit) return false

  let payload: EditRequest
  try {
    payload = isRead
      ? { room: url.searchParams.get('room') ?? '', type: url.searchParams.get('type') ?? '' }
      : (JSON.parse(await readBody(request)) as EditRequest)
  } catch {
    send(response, 400, { error: 'the request is not valid JSON' })
    return true
  }
  const room = payload.room ?? ''
  const type = payload.type ?? ''
  if (!parseRoom(room)) {
    send(response, 400, { error: 'the room name is not valid' })
    return true
  }
  if (!editable(type)) {
    send(response, 422, { error: 'the Agent can read and edit Markdown, DBML and Mermaid documents only' })
    return true
  }
  if (isEdit && (payload.mode !== 'direct' && payload.mode !== 'suggest')) {
    send(response, 422, { error: 'mode must be direct or suggest' })
    return true
  }
  if (isEdit && payload.mode === 'suggest' && isSourceType(type)) {
    send(response, 422, { error: 'DBML and Mermaid documents have no suggestions; only a direct edit is possible' })
    return true
  }
  if (isEdit && !payload.userID) {
    send(response, 400, { error: 'userID is required' })
    return true
  }

  const connection = await instance.openDirectConnection(room, { documentType: type, userID: payload.userID ?? '' })
  try {
    if (isRead) {
      let text = ''
      await connection.transact((doc) => {
        text = liveText(doc, type)
      })
      send(response, 200, { text, version: textVersion(text) })
      return true
    }
    let outcome: { status: number; body: unknown } = { status: 500, body: { error: 'the edit was not applied' } }
    await connection.transact((doc) => {
      const before = liveText(doc, type)
      if (payload.baseVersion && payload.baseVersion !== textVersion(before)) {
        outcome = { status: 409, body: { error: 'the document changed since it was read; read it again', version: textVersion(before) } }
        return
      }
      try {
        let suggestionIDs: string[] = []
        if (isSourceType(type)) {
          replaceSource(doc.getText(sourceName), applySourceOperations(before, payload.operations as SourceOperation[]))
        } else {
          const current = yDocToProsemirrorJSON(doc, fragmentName)
          const result = applyMarkdownOperations(current, payload.operations as MarkdownOperation[], {
            mode: payload.mode as 'direct' | 'suggest',
            author: payload.userID!,
            newID: randomUUID,
          })
          if (payload.mode === 'suggest') {
            const verdict = validateSuggesterChange(current, result.json, payload.userID!)
            if (!verdict.ok) throw new AgentEditError(`the suggestion was refused: ${verdict.reason}`)
          }
          const node = Node.fromJSON(documentBodySchema, result.json)
          updateYFragment(doc, doc.getXmlFragment(fragmentName), node, { mapping: new Map(), isOMark: new Map() } as never)
          suggestionIDs = result.suggestionIDs
        }
        const after = liveText(doc, type)
        outcome = { status: 200, body: { version: textVersion(after), suggestionIDs } }
      } catch (error) {
        if (!(error instanceof AgentEditError)) throw error
        outcome = { status: 422, body: { error: error.message } }
      }
    })
    send(response, outcome.status, outcome.body)
    return true
  } finally {
    await connection.disconnect()
  }
}
