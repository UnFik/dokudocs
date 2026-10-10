import { randomUUID } from 'node:crypto'
import { test, expect } from '../../fixtures/test-base'
import { generateDocument, generateWorkspace } from '../../helpers/factory'

const text = { nodeID: 'node-1', start: 'AA==', end: 'AQ==' }
const element = { kind: 'element', elementId: 'node-1', x: 0.5, y: 0.5 }
const source = { kind: 'source', start: 'AA==', end: 'AQ==' }

test.describe('Comment: anchor must fit the document type', () => {
  test('each document type takes its own anchor and refuses the others', async ({
    userRequest,
    userContext,
    playwright,
  }) => {
    const workspace = (await (await userRequest.post('/api/v1/workspaces', { data: generateWorkspace() })).json()).data
    const api = await playwright.request.newContext({
      baseURL: process.env.API_URL || 'http://localhost:8080',
      extraHTTPHeaders: {
        Authorization: `Bearer ${userContext.token}`,
        'X-Workspace-Id': workspace.id,
        'Content-Type': 'application/json',
      },
    })
    const createDocument = async (type: string) => {
      const response = await api.post('/api/v1/documents', {
        headers: { 'Idempotency-Key': randomUUID() },
        data: { ...generateDocument(type), type, content: type === 'markdown' ? 'hello' : 'x', isDraft: false },
      })
      expect(response.status(), await response.text()).toBe(201)
      return (await response.json()).data.id as string
    }
    const comment = async (documentID: string, anchor?: unknown) =>
      (
        await api.post(`/api/v1/documents/${documentID}/comments`, {
          data: { threadID: randomUUID(), selectedText: '', content: 'a comment', anchor },
        })
      ).status()

    const markdown = await createDocument('markdown')
    expect(await comment(markdown, text)).toBe(201)
    expect(await comment(markdown)).toBe(201)
    expect(await comment(markdown, element)).toBe(400)
    expect(await comment(markdown, source)).toBe(400)
    expect(await comment(markdown, { nodeID: 'node-1' })).toBe(400)

    const architecture = await createDocument('architecture')
    expect(await comment(architecture, element)).toBe(201)
    expect(await comment(architecture, { kind: 'element', elementId: 'a' })).toBe(201)
    expect(await comment(architecture)).toBe(400)
    expect(await comment(architecture, text)).toBe(400)
    expect(await comment(architecture, { ...element, x: 2 })).toBe(400)

    for (const type of ['dbdiagram', 'mermaid']) {
      const diagram = await createDocument(type)
      expect(await comment(diagram, source), type).toBe(201)
      expect(await comment(diagram), type).toBe(400)
      expect(await comment(diagram, text), type).toBe(400)
      expect(await comment(diagram, element), type).toBe(400)
    }
    await api.dispose()
  })
})
