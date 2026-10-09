import type { Authorized, BackendApi, LoadedDocument, StoredDocument } from './backend-api'

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const fromBase64 = (text: string) => new Uint8Array(Buffer.from(text, 'base64'))

/** Talks to the Go internal endpoints (`/internal/collab/*`) with the shared secret. */
export class HttpBackend implements BackendApi {
  constructor(
    private readonly baseURL: string,
    private readonly secret: string
  ) {}

  private async request(method: string, path: string, body?: unknown) {
    const response = await fetch(`${this.baseURL}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-collab-secret': this.secret },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return response
  }

  async authorize(token: string, workspaceID: string, documentID: string): Promise<Authorized | null> {
    const response = await this.request('POST', '/internal/collab/authorize', { token, workspaceID, documentID })
    // 403 is a token that is not valid; 401 is a wrong service secret, which is a misconfiguration.
    if (response.status === 403) return null
    if (response.status === 401) throw new Error('the backend refused the service secret')
    if (!response.ok) throw new Error(`authorize failed: ${response.status}`)
    return (await response.json()) as Authorized
  }

  async loadDocument(workspaceID: string, documentID: string): Promise<LoadedDocument> {
    const query = new URLSearchParams({ workspaceID, documentID })
    const response = await this.request('GET', `/internal/collab/document?${query}`)
    if (response.status === 404) throw new Error('document not found')
    if (!response.ok) throw new Error(`load failed: ${response.status}`)
    const body = (await response.json()) as { state: string | null; content: unknown | null }
    return { state: body.state ? fromBase64(body.state) : null, content: body.content ?? null }
  }

  async storeState(document: StoredDocument): Promise<void> {
    const query = new URLSearchParams({ workspaceID: document.workspaceID, documentID: document.documentID })
    const response = await this.request('PUT', `/internal/collab/document?${query}`, {
      state: toBase64(document.state),
      content: document.content,
      markdown: document.markdown,
      updatedBy: document.updatedBy,
      suggestions: document.suggestions,
      ...(document.thumbnail === undefined ? {} : { thumbnail: document.thumbnail }),
    })
    if (response.status !== 204) throw new Error(`store failed: ${response.status}`)
  }
}
