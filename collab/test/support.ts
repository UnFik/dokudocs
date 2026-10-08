import { createServer } from 'node:net'
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { ReplacedError, type BackendApi, type Access, type LoadedDocument, type StoredDocument } from '../src/backend-api'

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
  tokens = new Map<string, { userID: string; access: Access & { documentType?: string } }>()
  documents = new Map<string, LoadedDocument>()
  stores: StoredDocument[] = []
  /** The record each document holds now; a restore gives it a new one. */
  replacements = new Map<string, string>()

  grant(token: string, userID: string, access: Partial<Access & { documentType: string }> = {}) {
    this.tokens.set(token, {
      userID,
      access: { canRead: true, canEdit: true, canSuggest: true, ...access },
    })
  }

  async authorize(token: string, _workspaceID: string, documentID: string) {
    const found = this.tokens.get(token)
    if (!found) return null
    return { userID: found.userID, ...found.access, replacementID: this.replacements.get(documentID) }
  }

  async loadDocument(_workspaceID: string, documentID: string): Promise<LoadedDocument> {
    return this.documents.get(documentID) ?? { state: null, content: null }
  }

  async storeState(document: StoredDocument) {
    const current = this.replacements.get(document.documentID)
    if (document.replacementID && current && document.replacementID !== current) throw new ReplacedError()
    this.stores.push(document)
    this.documents.set(document.documentID, { state: document.state, content: document.content })
  }
}

export function connect(port: number, name: string, token: string) {
  const doc = new Y.Doc()
  const statelessMessages: unknown[] = []
  const provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${port}`,
    name,
    document: doc,
    token,
    onStateless: ({ payload }) => statelessMessages.push(JSON.parse(payload)),
  })
  const synced = new Promise<void>((resolve) => provider.on('synced', () => resolve()))
  const refused = new Promise<string>((resolve) =>
    provider.on('authenticationFailed', ({ reason }: { reason: string }) => resolve(reason))
  )
  return { doc, provider, synced, refused, statelessMessages }
}

export async function waitFor(check: () => boolean | Promise<boolean>, ms = 5000) {
  const stop = Date.now() + ms
  while (Date.now() < stop) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('timed out waiting for the condition')
}
