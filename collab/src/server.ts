import { Redis } from '@hocuspocus/extension-redis'
import { Server, type Extension } from '@hocuspocus/server'
import * as Y from 'yjs'
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from 'y-prosemirror'
import type { Authorized, BackendApi } from './backend-api'
import { toMarkdown } from './markdown'
import { permissions } from './permissions'
import { parseRoom } from './room'
import { documentBodySchema } from './schema'

// The editor binds its document to this fragment.
const fragmentName = 'body'

export type CollabContext = { userID: string; access: Authorized; workspaceID: string; documentID: string }

export type CollabServer = { stop(): Promise<void> }

export type CollabOptions = {
  backend: BackendApi
  port: number
  /** How long after the last change the state is stored, and the longest it may wait. */
  debounceMs?: number
  maxDebounceMs?: number
  /** When set, instances share rooms through this Redis. */
  redisURL?: string | null
}

/** What the provider shows as the reason a connection was refused. */
function refusal(reason: 'unauthorized' | 'forbidden') {
  return Object.assign(new Error(reason), { reason })
}

function authentication(backend: BackendApi): Extension<CollabContext> {
  return {
    extensionName: 'authentication',
    async onAuthenticate({ token, documentName, connectionConfig }) {
      const room = parseRoom(documentName)
      if (!room) throw refusal('forbidden')
      const access = await backend.authorize(token, room.workspaceID, room.documentID)
      // A token that is not valid means signing in again; no access means asking for it.
      if (!access) throw refusal('unauthorized')
      if (!access.canRead) throw refusal('forbidden')
      // A viewer only reads. Someone who can suggest still writes; what they may
      // write is checked per message.
      connectionConfig.readOnly = !access.canEdit && !access.canSuggest
      return { userID: access.userID, access, ...room }
    },
    // The editor needs to know what it may do; the connection itself only says read or write.
    async connected({ connection, context }) {
      connection.sendStateless(
        JSON.stringify({ type: 'access', canEdit: context.access.canEdit, canSuggest: context.access.canSuggest })
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
      if (message.type !== 'comments_changed') return
      document.broadcastStateless(JSON.stringify({ type: 'comments_changed' }), (other) => other !== connection)
    },
  }
}

/** A plain HTTP answer for load balancers; everything else is left to Hocuspocus. */
function health(): Extension {
  return {
    extensionName: 'health',
    async onRequest({ request, response }) {
      if (request.url !== '/health') return
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('ok')
      // Hocuspocus stops here when a hook throws a falsy value.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw null
    },
  }
}

function persistence(backend: BackendApi): Extension<CollabContext> {
  return {
    extensionName: 'persistence',
    async onLoadDocument({ document, documentName }) {
      const room = parseRoom(documentName)
      if (!room) throw new Error('forbidden')
      const { state, content } = await backend.loadDocument(room.workspaceID, room.documentID)
      if (state) {
        Y.applyUpdate(document, state)
      } else if (content) {
        // A document made from JSON alone (a seed, an import): build its state once.
        const seed = prosemirrorJSONToYDoc(documentBodySchema, content, fragmentName)
        Y.applyUpdate(document, Y.encodeStateAsUpdate(seed))
        seed.destroy()
      }
    },
    async onStoreDocument({ document, documentName }) {
      const room = parseRoom(documentName)
      if (!room) return
      const content = yDocToProsemirrorJSON(document, fragmentName)
      await backend.storeState({
        ...room,
        state: Y.encodeStateAsUpdate(document),
        content,
        markdown: toMarkdown(content),
      })
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
  const server = new Server<CollabContext>({
    port: options.port,
    quiet: true,
    debounce: options.debounceMs ?? 2000,
    maxDebounce: options.maxDebounceMs ?? 10000,
    extensions: [
      health(),
      authentication(options.backend),
      permissions(fragmentName),
      signals(),
      persistence(options.backend),
      ...(options.redisURL ? [redis(options.redisURL)] : []),
    ],
  })
  await server.listen()
  return { stop: () => server.destroy() }
}
