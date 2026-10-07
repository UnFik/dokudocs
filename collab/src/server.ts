import { Redis } from '@hocuspocus/extension-redis'
import { Server, type Extension } from '@hocuspocus/server'
import * as Y from 'yjs'
import { yDocToProsemirrorJSON } from 'y-prosemirror'
import { architectureSummary, architectureToJSON, seedArchitecture } from './architecture'
import type { Authorized, BackendApi, DocumentType } from './backend-api'
import { toMarkdown } from './markdown'
import { instrumentation, log, Metrics } from './operations'
import { permissions } from './permissions'
import { parseRoom } from './room'
import { seedFromJSON } from './seed'
import { suggestionsIn } from './suggestions'

// The editor binds its document to this fragment.
const fragmentName = 'body'

export type CollabContext = {
  userID: string
  access: Authorized
  workspaceID: string
  documentID: string
  documentType: DocumentType
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
}

/** What the provider shows as the reason a connection was refused. */
function refusal(reason: 'unauthorized' | 'forbidden' | 'busy', metrics: Metrics) {
  metrics.refuse(reason)
  log('connection_refused', { reason })
  return Object.assign(new Error(reason), { reason })
}

function authentication(backend: BackendApi, metrics: Metrics, maxConnections: number): Extension<CollabContext> {
  return {
    extensionName: 'authentication',
    async onAuthenticate({ token, documentName, connectionConfig }) {
      if (metrics.connections >= maxConnections) throw refusal('busy', metrics)
      const room = parseRoom(documentName)
      if (!room) throw refusal('forbidden', metrics)
      const access = await backend.authorize(token, room.workspaceID, room.documentID)
      // A token that is not valid means signing in again; no access means asking for it.
      if (!access) throw refusal('unauthorized', metrics)
      if (!access.canRead) throw refusal('forbidden', metrics)
      const documentType = access.documentType ?? 'markdown'
      if (documentType !== 'markdown' && documentType !== 'architecture') throw refusal('forbidden', metrics)
      // A viewer only reads. On Markdown someone who can suggest still writes; what they may
      // write is checked per message. A canvas has no suggest mode: only an editor writes.
      connectionConfig.readOnly = documentType === 'architecture' ? !access.canEdit : !access.canEdit && !access.canSuggest
      return { userID: access.userID, access, ...room, documentType }
    },
    // The editor needs to know what it may do; the connection itself only says read or write.
    async connected({ connection, context }) {
      connection.sendStateless(
        JSON.stringify({
          type: 'access',
          canEdit: context.access.canEdit,
          canSuggest: context.documentType === 'architecture' ? false : context.access.canSuggest,
          // Someone who may suggest on Markdown may comment; on a canvas that is all they may do.
          canComment: context.access.canEdit || context.access.canSuggest,
        })
      )
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
          const name = url.searchParams.get('room') ?? ''
          const open = instance.documents.get(name)
          if (open) {
            droppedRooms.add(name)
            open.broadcastStateless(JSON.stringify({ type: 'reloaded' }))
            instance.closeConnections(name)
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
        Y.applyUpdate(document, documentType === 'architecture' ? seedArchitecture(content) : seedFromJSON(content))
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
    async onStoreDocument({ document, documentName }) {
      const room = parseRoom(documentName)
      if (!room || droppedRooms.has(documentName)) return
      const derived =
        roomType(documentName) === 'architecture'
          ? (() => {
              const content = architectureToJSON(document)
              return { content, markdown: architectureSummary(content), suggestions: [] }
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
        metrics.storeFailures++
        log('store_failed', { room: documentName, error: String(error) })
        throw error
      }
    },
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
      authentication(options.backend, metrics, options.maxConnections ?? 1000),
      permissions(fragmentName, metrics),
      signals(),
      persistence(options.backend, metrics),
      ...(options.redisURL ? [redis(options.redisURL)] : []),
    ],
  })
  await server.listen()
  return { stop: () => server.destroy() }
}
