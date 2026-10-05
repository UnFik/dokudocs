import { Server, type Extension } from '@hocuspocus/server'
import * as Y from 'yjs'
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from 'y-prosemirror'
import type { Authorized, BackendApi } from './backend-api'
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
}

function authentication(backend: BackendApi): Extension<CollabContext> {
  return {
    extensionName: 'authentication',
    async onAuthenticate({ token, documentName, connectionConfig }) {
      const room = parseRoom(documentName)
      if (!room) throw new Error('forbidden')
      const access = await backend.authorize(token, room.workspaceID, room.documentID)
      if (!access?.canRead) throw new Error('forbidden')
      // A viewer only reads. Someone who can suggest still writes; what they may
      // write is checked per message.
      connectionConfig.readOnly = !access.canEdit && !access.canSuggest
      return { userID: access.userID, access, ...room }
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
      await backend.storeState({
        ...room,
        state: Y.encodeStateAsUpdate(document),
        content: yDocToProsemirrorJSON(document, fragmentName),
      })
    },
  }
}

export async function createCollabServer(options: CollabOptions): Promise<CollabServer> {
  const server = new Server<CollabContext>({
    port: options.port,
    quiet: true,
    debounce: options.debounceMs ?? 2000,
    maxDebounce: options.maxDebounceMs ?? 10000,
    extensions: [authentication(options.backend), persistence(options.backend)],
  })
  await server.listen()
  return { stop: () => server.destroy() }
}
