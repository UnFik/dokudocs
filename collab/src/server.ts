import { Redis } from '@hocuspocus/extension-redis'
import { Server, type Document, type Extension } from '@hocuspocus/server'
import * as Y from 'yjs'
import { yDocToProsemirrorJSON } from 'y-prosemirror'
import { architectureSummary, architectureThumbnail, architectureToJSON, seedArchitecture } from './architecture'
import { documentTypes, isSourceType, ReplacedError, type Authorized, type BackendApi, type DocumentType } from './backend-api'
import { toMarkdown } from './markdown'
import { instrumentation, log, Metrics } from './operations'
import { permissions } from './permissions'
import { parseRoom } from './room'
import { seedFromJSON } from './seed'
import { seedSource, sourceToJSON } from './source'
import { suggestionsIn } from './suggestions'
import { inSpan } from './tracing'

// The editor binds its document to this fragment.
const fragmentName = 'body'

export type CollabContext = {
  userID: string
  access: Authorized
  workspaceID: string
  documentID: string
  documentType: DocumentType
  /** A source room only: the record it holds. */
  replacementID?: string
  /** The token the connection signed in with, to ask again what it may do. */
  token: string
}

/** The kind of each open room, set when it loads; the store hook has no connection to ask. */
const roomTypes = new Map<string, DocumentType>()
export const roomType = (documentName: string): DocumentType => roomTypes.get(documentName) ?? 'markdown'

export type CollabServer = { stop(): Promise<void> }

export type CollabOptions = {
  backend: BackendApi
  port: number
  /** How long after the last change the state is stored, and the longest it may wait. */
  debounceMs?: number
  maxDebounceMs?: number
  /** When set, instances share rooms through this Redis. */
  redisURL?: string | null
  /** The secret the API sends to reload a room; without one the endpoint refuses everyone. */
  serviceSecret?: string | null
  /** Open connections at once; one more is refused as busy. */
  maxConnections?: number
  /** The largest message accepted from a client; a larger one closes its connection. */
  maxPayloadBytes?: number
  /** Messages one connection may send in a second. */
  maxMessagesPerSecond?: number
  /** How often an open source-room connection asks the API again what it may do. */
  accessRecheckMs?: number
}

/** What the provider shows as the reason a connection was refused. */
function refusal(reason: 'unauthorized' | 'forbidden' | 'busy' | 'replaced', metrics: Metrics) {
  metrics.refuse(reason)
  log('connection_refused', { reason })
  return Object.assign(new Error(reason), { reason })
}

const accessMessage = (context: CollabContext, access: Authorized) =>
  JSON.stringify({
    type: 'access',
    canEdit: access.canEdit,
    canSuggest: context.documentType === 'markdown' ? access.canSuggest : false,
    // Someone who may suggest on Markdown may comment; on a canvas that is all they may do.
    // A source has no comments in this release.
    canComment: isSourceType(context.documentType) ? false : access.canEdit || access.canSuggest,
  })

function authentication(
  backend: BackendApi,
  metrics: Metrics,
  maxConnections: number,
  accessRecheckMs: number
): Extension<CollabContext> {
  return {
    extensionName: 'authentication',
    onAuthenticate: ({ token, documentName, connectionConfig }) =>
      inSpan('collab connect', { 'collab.room': documentName }, async () => {
        if (metrics.connections >= maxConnections) throw refusal('busy', metrics)
        const room = parseRoom(documentName)
        if (!room) throw refusal('forbidden', metrics)
        const access = await backend.authorize(token, room.workspaceID, room.documentID)
        // A token that is not valid means signing in again; no access means asking for it.
        if (!access) throw refusal('unauthorized', metrics)
        if (!access.canRead) throw refusal('forbidden', metrics)
        const documentType = (access.documentType ?? 'markdown') as DocumentType
        if (!documentTypes.includes(documentType)) throw refusal('forbidden', metrics)
        // A device opening a record a restore replaced must not send what it holds: the editor
        // keeps its unsent edits as a recovery copy and opens the current record instead.
        if (isSourceType(documentType) && (!room.replacementID || room.replacementID !== access.replacementID))
          throw refusal('replaced', metrics)
        // A viewer only reads. On Markdown someone who can suggest still writes; what they may
        // write is checked per message. A canvas or a source has no suggest mode: only an editor writes.
        connectionConfig.readOnly = documentType === 'markdown' ? !access.canEdit && !access.canSuggest : !access.canEdit
        return { userID: access.userID, access, ...room, documentType, token }
      }),
    // The editor needs to know what it may do; the connection itself only says read or write.
    async connected({ connection, context }) {
      connection.sendStateless(accessMessage(context, context.access))
      if (!isSourceType(context.documentType)) return
      // Access can be taken away while the room is open: ask again, and close or narrow the connection.
      let last = context.access
      const recheck = setInterval(async () => {
        let access: Authorized | null
        try {
          access = await backend.authorize(context.token, context.workspaceID, context.documentID)
        } catch {
          return // the API is unreachable; the connection keeps what it had until it answers
        }
        const reason = !access ? 'unauthorized' : !access.canRead ? 'forbidden' : access.replacementID !== context.replacementID ? 'replaced' : null
        if (reason || !access) {
          clearInterval(recheck)
          metrics.refuse(reason ?? 'forbidden')
          connection.sendStateless(JSON.stringify({ type: 'refused', reason }))
          connection.close()
          return
        }
        connection.readOnly = !access.canEdit
        if (access.canEdit !== last.canEdit) connection.sendStateless(accessMessage(context, access))
        last = access
      }, accessRecheckMs)
      connection.onClose(() => clearInterval(recheck))
    },
  }
}

/** Signals one editor sends to the others in the room, such as "the comments changed". */
function signals(): Extension<CollabContext> {
  return {
    extensionName: 'signals',
    async onStateless({ payload, document, connection }) {
      let message: { type?: unknown }
      try {
        message = JSON.parse(payload)
      } catch {
        return
      }
      if (message.type === 'ping') {
        // Messages on a connection are handled in order: the answer shows the room has everything sent before it.
        connection.sendStateless(JSON.stringify({ type: 'pong', id: (message as { id?: unknown }).id }))
        return
      }
      if (message.type !== 'comments_changed') return
      document.broadcastStateless(JSON.stringify({ type: 'comments_changed' }), (other) => other !== connection)
    },
  }
}

/** Rooms the API asked to drop: what they hold is stale and must not be stored. */
const droppedRooms = new Set<string>()

/** Closes a room whose record was replaced: its editors reopen the document, and it is never stored. */
function dropRoom(document: { name: string; broadcastStateless(payload: string): void; getConnections(): { close(): void }[] }) {
  droppedRooms.add(document.name)
  document.broadcastStateless(JSON.stringify({ type: 'reloaded' }))
  for (const connection of document.getConnections()) connection.close()
}

/** The user who made the latest change in each open room. */
const lastEditors = new Map<string, string>()

/** Plain HTTP endpoints: a health answer for load balancers and the API's room reload. */
function http(secret: string | null, metrics: Metrics): Extension {
  return {
    extensionName: 'http',
    async onRequest({ request, response, instance }) {
      const url = new URL(request.url ?? '/', 'http://collab')
      if (url.pathname === '/health') {
        response.writeHead(200, { 'content-type': 'text/plain' })
        response.end('ok')
      } else if (url.pathname === '/metrics') {
        response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' })
        response.end(metrics.render())
      } else if (url.pathname === '/internal/reload' && request.method === 'POST') {
        const sent = request.headers['x-collab-secret']
        if (!secret || sent !== secret) {
          response.writeHead(401).end()
        } else {
          // The API names the document; a source room also names its record, so close every room of it.
          const name = url.searchParams.get('room') ?? ''
          for (const [open, document] of instance.documents) {
            if (open !== name && !open.startsWith(`${name}.`)) continue
            dropRoom(document)
          }
          response.writeHead(204).end()
        }
      } else {
        return
      }
      // Hocuspocus stops here when a hook throws a falsy value.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw null
    },
  }
}

function persistence(backend: BackendApi, metrics: Metrics): Extension<CollabContext> {
  return {
    extensionName: 'persistence',
    async onLoadDocument({ document, documentName, context }) {
      const room = parseRoom(documentName)
      if (!room) throw new Error('forbidden')
      const documentType = (context as CollabContext | undefined)?.documentType ?? 'markdown'
      roomTypes.set(documentName, documentType)
      const { state, content } = await backend.loadDocument(room.workspaceID, room.documentID)
      if (state) {
        Y.applyUpdate(document, state)
      } else if (content) {
        // A document made from JSON alone (a seed, an import, a restore): build its state once.
        Y.applyUpdate(
          document,
          documentType === 'architecture'
            ? seedArchitecture(content)
            : isSourceType(documentType)
              ? seedSource(content)
              : seedFromJSON(content)
        )
      }
    },
    async onChange({ documentName, context }) {
      const userID = (context as CollabContext | undefined)?.userID
      if (userID) lastEditors.set(documentName, userID)
    },
    async afterUnloadDocument({ documentName }) {
      droppedRooms.delete(documentName)
      lastEditors.delete(documentName)
      roomTypes.delete(documentName)
    },
    onStoreDocument: ({ document, documentName }) => store(document, documentName),
    // An editor asks for its changes to be in the database now, before it says "saved" or names a version.
    // Messages on a connection are handled in order, so the store holds everything sent before the question.
    async onStateless({ payload, document, connection }) {
      let message: { type?: unknown; id?: unknown }
      try {
        message = JSON.parse(payload)
      } catch {
        return
      }
      if (message.type !== 'flush') return
      const ok = await document.saveMutex.runExclusive(() => store(document, document.name)).then(
        () => true,
        () => false
      )
      connection.sendStateless(JSON.stringify({ type: 'stored', id: message.id, ok }))
    },
  }

  function store(document: Document, documentName: string) {
    return inSpan('collab store', { 'collab.room': documentName }, () => storeNow(document, documentName))
  }

  async function storeNow(document: Document, documentName: string) {
    const room = parseRoom(documentName)
    if (!room || droppedRooms.has(documentName)) return
    const type = roomType(documentName)
    const derived = isSourceType(type)
      ? (() => {
          const content = sourceToJSON(document)
          return { content, markdown: content.source, suggestions: [] }
        })()
      : type === 'architecture'
        ? (() => {
            const content = architectureToJSON(document)
            return {
              content,
              markdown: architectureSummary(content),
              suggestions: [],
              thumbnail: architectureThumbnail(content),
            }
          })()
        : (() => {
            const content = yDocToProsemirrorJSON(document, fragmentName)
            return { content, markdown: toMarkdown(content), suggestions: suggestionsIn(content) }
          })()
    try {
      await backend.storeState({
        ...room,
        state: Y.encodeStateAsUpdate(document),
        ...derived,
        updatedBy: lastEditors.get(documentName) ?? null,
      })
    } catch (error) {
      if (error instanceof ReplacedError) {
        // A restore committed before the API closed this room: what it holds is stale.
        log('store_replaced', { room: documentName })
        dropRoom(document)
        throw error
      }
      metrics.storeFailures++
      log('store_failed', { room: documentName, error: String(error) }, 'ERROR')
      throw error
    }
  }
}

function redis(url: string): Extension {
  const parsed = new URL(url)
  return new Redis({
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    options: { password: parsed.password || undefined, db: Number(parsed.pathname.slice(1) || 0) },
  })
}

export async function createCollabServer(options: CollabOptions): Promise<CollabServer> {
  const metrics = new Metrics()
  const server = new Server<CollabContext>({
    port: options.port,
    quiet: true,
    debounce: options.debounceMs ?? 2000,
    maxDebounce: options.maxDebounceMs ?? 10000,
    websocketOptions: { maxPayload: options.maxPayloadBytes ?? 16 * 1024 * 1024 },
    extensions: [
      http(options.serviceSecret ?? null, metrics),
      instrumentation(metrics, options.maxMessagesPerSecond ?? 500),
      authentication(options.backend, metrics, options.maxConnections ?? 1000, options.accessRecheckMs ?? 30_000),
      permissions(fragmentName, metrics),
      signals(),
      persistence(options.backend, metrics),
      ...(options.redisURL ? [redis(options.redisURL)] : []),
    ],
  })
  await server.listen()
  return { stop: () => server.destroy() }
}
