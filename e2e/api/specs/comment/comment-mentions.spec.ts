import { randomUUID } from 'node:crypto'
import { test, expect } from '../../fixtures/test-base'
import { generateDocument, generateUser, generateWorkspace } from '../../helpers/factory'

const textAnchor = { nodeID: 'node-1', start: 'AA==', end: 'AQ==' }
const token = (name: string, userID: string) => `@[${name}](user:${userID})`

test.describe('Comment: mentions', () => {
  test('a mention names a member by id, and the stored name is the member’s own', async ({
    userRequest,
    userContext,
    request,
    playwright,
  }) => {
    const base = process.env.API_URL || 'http://localhost:8080'
    const workspace = (await (await userRequest.post('/api/v1/workspaces', { data: generateWorkspace() })).json()).data
    const as = (accessToken: string) =>
      playwright.request.newContext({
        baseURL: base,
        extraHTTPHeaders: {
          Authorization: `Bearer ${accessToken}`,
          'X-Workspace-Id': workspace.id,
          'Content-Type': 'application/json',
        },
      })
    const owner = await as(userContext.token)

    const register = async () => {
      const data = generateUser()
      const response = await request.post('/api/v1/auth/register', { data })
      expect(response.status()).toBe(201)
      const body = (await response.json()).data
      return { ...data, id: body.user.id as string, token: body.accessToken as string }
    }
    const member = await register()
    const outsider = await register()
    const invite = await userRequest.post(`/api/v1/workspaces/${workspace.id}/invites`, {
      data: { email: member.email, role: 'member' },
    })
    expect(invite.status()).toBe(201)

    const created = await owner.post('/api/v1/documents', {
      headers: { 'Idempotency-Key': randomUUID() },
      data: { ...generateDocument('Mentions'), visibility: 'workspace', isDraft: false },
    })
    expect(created.status()).toBe(201)
    const documentID = (await created.json()).data.id as string
    const url = `/api/v1/documents/${documentID}/comments`
    const list = async () => (await (await owner.get(url)).json()).data as { id: string; content: string; replies: { content: string }[] }[]

    const threadID = randomUUID()
    const first = await owner.post(url, {
      data: { threadID, selectedText: 'x', content: `hello ${token('A made-up name', member.id)}`, anchor: textAnchor },
    })
    expect(first.status()).toBe(201)
    const stored = (await list()).find((thread) => thread.id === threadID)
    expect(stored?.content).toBe(`hello ${token(member.fullName, member.id)}`)

    const bad = (content: string) => owner.post(url, { data: { threadID: randomUUID(), selectedText: '', content, anchor: textAnchor } })
    expect((await bad(token('Nobody', randomUUID()))).status()).toBe(400)
    expect((await bad(token(outsider.fullName, outsider.id))).status()).toBe(400)

    const reply = await owner.post(`${url}/${threadID}/replies`, {
      data: { replyID: randomUUID(), content: token('Old', member.id) },
    })
    expect(reply.status()).toBe(201)
    const withReply = (await list()).find((thread) => thread.id === threadID)
    expect(withReply?.replies[0].content).toBe(token(member.fullName, member.id))
    const badReply = await owner.post(`${url}/${threadID}/replies`, {
      data: { replyID: randomUUID(), content: token(outsider.fullName, outsider.id) },
    })
    expect(badReply.status()).toBe(400)

    const edit = await owner.patch(`${url}/${threadID}`, { data: { content: `edited ${token('Old', member.id)}` } })
    expect(edit.status()).toBe(204)
    const editBad = await owner.patch(`${url}/${threadID}`, { data: { content: token(outsider.fullName, outsider.id) } })
    expect(editBad.status()).toBe(400)
    expect((await list()).find((thread) => thread.id === threadID)?.content).toBe(`edited ${token(member.fullName, member.id)}`)

    // Tokens that are not well formed are plain text, not mentions.
    const plain = await bad('write to a@b.id or @[Cut off](user:')
    expect(plain.status()).toBe(201)
    await owner.dispose()
  })

  test('a name that could break a mention is refused', async ({ request, userRequest }) => {
    for (const fullName of ['Ana [Bo]', 'Ana (Bo)', '@ana', 'Ana\nBo']) {
      const response = await request.post('/api/v1/auth/register', { data: { ...generateUser(), fullName } })
      expect(response.status(), fullName).toBe(400)
      const profile = await userRequest.put('/api/v1/users/me/profile', { data: { fullName } })
      expect(profile.status(), fullName).toBe(400)
    }
    const fine = await userRequest.put('/api/v1/users/me/profile', { data: { fullName: 'Ana Bo' } })
    expect(fine.status()).toBe(200)
  })
})
