import { test, expect } from '../../fixtures/test-base'
import { generateWorkspace } from '../../helpers/factory'

// Code the Agent writes through MCP stays code: a code block with its lines and
// indentation intact, readable and editable afterwards (create_document and
// edit_document_content both go through the same rules).

const JSON_BODY = '{\n  "data": {\n    "id": 1,\n\n    "tags": ["a", "b"]\n  }\n}'
const EXAMPLE = `Request body:\n\n\`\`\`json\n${JSON_BODY}\n\`\`\`\n\nThen wait.`

type Json = Record<string, any>

test.describe('MCP: fenced code blocks', () => {
  let counter = 0

  test('create, read, append and change code through MCP tools', async ({ userRequest, request }) => {
    const workspace = (await (await userRequest.post('/api/v1/workspaces', { data: generateWorkspace() })).json()).data
    const allowed = await userRequest.put('/api/v1/users/me/ai-permissions', { data: { allowed: ['read', 'documents', 'content'] } })
    expect(allowed.status()).toBe(200)
    const keyRes = await userRequest.post('/api/v1/users/me/mcp-keys', { data: { name: 'code-blocks e2e', expiresInDays: 7 } })
    expect(keyRes.status()).toBe(201)
    const secret = (await keyRes.json()).data.secret as string

    const headers: Record<string, string> = {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    }
    const rpc = async (method: string, params?: Json) => {
      const res = await request.post('/api/v1/mcp', { headers, data: { jsonrpc: '2.0', id: ++counter, method, params } })
      expect(res.status(), await res.text()).toBeLessThan(300)
      const session = res.headers()['mcp-session-id']
      if (session) headers['Mcp-Session-Id'] = session
      const body = await res.text()
      const line = body.trim().startsWith('{') ? body : (body.split('\n').find((l) => l.startsWith('data:')) ?? '').slice(5)
      return JSON.parse(line) as Json
    }
    const tool = async (name: string, args: Json) => {
      const reply = await rpc('tools/call', { name, arguments: args })
      const text = reply.result?.content?.[0]?.text as string
      expect(reply.result?.isError, text).toBeFalsy()
      return JSON.parse(text).data as Json
    }

    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } })
    await request.post('/api/v1/mcp', { headers, data: { jsonrpc: '2.0', method: 'notifications/initialized' } })

    // create_document keeps the fence
    const created = await tool('create_document', { workspace_id: workspace.id, type: 'markdown', title: 'Code blocks', text: `# Auth\n\n${EXAMPLE}` })
    const read = async () => tool('read_document', { workspace_id: workspace.id, document_id: created.id })
    const first = await read()
    expect(first.content).toContain(`\`\`\`json\n${JSON_BODY}\n\`\`\``)

    // the editor's document has a real code block, not a paragraph
    const stored = (await (await userRequest.get(`/api/v1/documents/${created.id}`, { headers: { 'X-Workspace-Id': workspace.id } })).json()).data
    const blocks = stored.contentJSON.content[0].content as Json[]
    const codeBlock = blocks.find((b) => b.type === 'code_block')!
    expect(codeBlock, 'a code_block node').toBeTruthy()
    expect(JSON.parse(codeBlock.attrs.bodyAttributes)).toEqual({ type: 'fenced', lang: 'json' })
    expect(codeBlock.content).toEqual([{ type: 'text', text: JSON_BODY }])

    // edit_document_content appends a second block and changes text inside the first
    const edited = await tool('edit_document_content', {
      workspace_id: workspace.id,
      document_id: created.id,
      version: first.version,
      operations: [
        { type: 'append_section', heading: 'Curl', level: 2, text: '```sh\ncurl -s \\\n  -H "Authorization: Bearer $TOKEN" \\\n  https://example.test/api/v1/auth/me\n```' },
        { type: 'replace_text', find: '"id": 1,\n\n    "tags"', replace: '"id": 2,\n    "tags"' },
      ],
    })
    expect(edited.version).not.toBe(first.version)

    const second = await read()
    expect(second.content).toContain('```sh\ncurl -s \\\n  -H "Authorization: Bearer $TOKEN" \\\n  https://example.test/api/v1/auth/me\n```')
    expect(second.content).toContain('```json\n{\n  "data": {\n    "id": 2,\n    "tags": ["a", "b"]\n  }\n}\n```')
    expect(second.content).not.toContain('"id": 1')
  })
})
