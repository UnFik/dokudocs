import { createServer } from 'node:net'
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'
import type { BackendApi, Access, StoredDocument } from '../src/backend-api'

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.listen(0, () => {
      const { port } = probe.address() as { port: number }
      probe.close(() => resolve(port))
    })
    probe.on('error', reject)
  })
}

/** An in-memory stand-in for the Go API: the boundary the service talks to. */
export class FakeBackend implements BackendApi {
  tokens = new Map<string, { userID: string; access: Access }>()
  states = new Map<string, Uint8Array>()
  stores: StoredDocument[] = []

  grant(token: string, userID: string, access: Partial<Access> = {}) {
    this.tokens.set(token, {
      userID,
      access: { canRead: true, canEdit: true, canSuggest: true, ...access },
    })
  }

  async authorize(token: string, _workspaceID: string, _documentID: string) {
    const found = this.tokens.get(token)
    if (!found) return null
    return { userID: found.userID, ...found.access }
  }

  async loadState(_workspaceID: string, documentID: string) {
    return this.states.get(documentID) ?? null
  }

  async storeState(document: StoredDocument) {
    this.stores.push(document)
    this.states.set(document.documentID, document.state)
  }
}

export function connect(port: number, name: string, token: string) {
  const doc = new Y.Doc()
  const provider = new HocuspocusProvider({ url: `ws://127.0.0.1:${port}`, name, document: doc, token })
  const synced = new Promise<void>((resolve) => provider.on('synced', () => resolve()))
  const refused = new Promise<string>((resolve) =>
    provider.on('authenticationFailed', ({ reason }: { reason: string }) => resolve(reason))
  )
  return { doc, provider, synced, refused }
}

export async function waitFor(check: () => boolean | Promise<boolean>, ms = 5000) {
  const stop = Date.now() + ms
  while (Date.now() < stop) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('timed out waiting for the condition')
}
