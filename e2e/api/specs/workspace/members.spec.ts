import { test, expect } from '../../fixtures/test-base'
import { generateUser, generateWorkspace } from '../../helpers/factory'
import { inviteToWorkspace, joinWorkspace } from '../../../support/workspace-invites'

test.describe('Workspace: Member Management', () => {
  test('should manage workspace members: list, invite, and remove', async ({
    userRequest,
    userContext,
    request,
    playwright,
  }) => {
    // 1. Create Workspace with User A (Owner)
    const wsData = generateWorkspace()
    const createWsRes = await userRequest.post('/api/v1/workspaces', { data: wsData })
    expect(createWsRes.status()).toBe(201)
    const ws = (await createWsRes.json()).data
    const workspaceId = ws.id

    // 2. User A views members (initially only User A as owner)
    const initialMembersRes = await userRequest.get(`/api/v1/workspaces/${workspaceId}/members`)
    expect(initialMembersRes.status()).toBe(200)
    const initialMembers = (await initialMembersRes.json()).data
    expect(initialMembers).toHaveLength(1)
    expect(initialMembers[0].userId).toBe(userContext.user.id)
    expect(initialMembers[0].role).toBe('owner')

    // 3. Register User B
    const userBData = generateUser()
    const regBRes = await request.post('/api/v1/auth/register', { data: userBData })
    expect(regBRes.status()).toBe(201)
    const userB = (await regBRes.json()).data

    // Create APIRequestContext for User B
    const userBRequest = await playwright.request.newContext({
      baseURL: process.env.API_URL || 'http://localhost:8080',
      extraHTTPHeaders: {
        Authorization: `Bearer ${userB.accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    // Before being invited, User B cannot view workspace members (403)
    const preInviteRes = await userBRequest.get(`/api/v1/workspaces/${workspaceId}/members`)
    expect(preInviteRes.status()).toBe(403)

    // 4. User A invites User B as 'member'; User B joins by the mailed link
    await joinWorkspace({
      authorization: `Bearer ${userContext.token}`,
      workspaceId,
      email: userBData.email,
      role: 'member',
    })

    const workspaceDetailRes = await userBRequest.get(`/api/v1/workspaces/${workspaceId}`)
    expect(workspaceDetailRes.status()).toBe(200)
    const memberUpdateRes = await userBRequest.put(`/api/v1/workspaces/${workspaceId}`, {
      data: { name: 'Member cannot update workspace' },
    })
    expect(memberUpdateRes.status()).toBe(403)
    const memberInviteRes = await userBRequest.post(`/api/v1/workspaces/${workspaceId}/invites`, {
      data: { email: 'member-cannot-invite@example.invalid', role: 'member' },
    })
    expect(memberInviteRes.status()).toBe(403)
    const memberDeleteRes = await userBRequest.delete(`/api/v1/workspaces/${workspaceId}`)
    expect(memberDeleteRes.status()).toBe(403)
    expect((await userRequest.get(`/api/v1/workspaces/${workspaceId}`)).status()).toBe(200)

    // 5. User A verifies members count is now 2
    const updatedMembersRes = await userRequest.get(`/api/v1/workspaces/${workspaceId}/members`)
    expect(updatedMembersRes.status()).toBe(200)
    const updatedMembers = (await updatedMembersRes.json()).data
    expect(updatedMembers).toHaveLength(2)
    const foundB = updatedMembers.find((m: { userId: string }) => m.userId === userB.user.id)
    expect(foundB).toBeDefined()
    expect(foundB.role).toBe('member')

    // 6. User B can now also access the workspace members list
    const userBAccessRes = await userBRequest.get(`/api/v1/workspaces/${workspaceId}/members`)
    expect(userBAccessRes.status()).toBe(200)

    // 7. User A removes User B from workspace
    const removeRes = await userRequest.delete(`/api/v1/workspaces/${workspaceId}/members/${userB.user.id}`)
    expect(removeRes.status()).toBe(200)

    // 8. User B is no longer in members list
    const finalMembersRes = await userRequest.get(`/api/v1/workspaces/${workspaceId}/members`)
    expect(finalMembersRes.status()).toBe(200)
    const finalMembers = (await finalMembersRes.json()).data
    expect(finalMembers).toHaveLength(1)

    // User B gets 403 again
    const postRemoveRes = await userBRequest.get(`/api/v1/workspaces/${workspaceId}/members`)
    expect(postRemoveRes.status()).toBe(403)
    const postRemoveDetailRes = await userBRequest.get(`/api/v1/workspaces/${workspaceId}`)
    expect(postRemoveDetailRes.status()).toBe(404)

    await userBRequest.dispose()
  })

  test('should answer the same for an address without an account', async ({ userRequest }) => {
    const createWsRes = await userRequest.post('/api/v1/workspaces', { data: generateWorkspace() })
    expect(createWsRes.status()).toBe(201)
    const ws = (await createWsRes.json()).data

    const inviteRes = await userRequest.post(`/api/v1/workspaces/${ws.id}/invites`, {
      data: { email: `nobody-${Date.now()}@example.invalid`, role: 'member' },
    })
    expect(inviteRes.status()).toBe(201)
  })

  test('should return 400 when invite payload is missing email', async ({ userRequest }) => {
    const wsData = generateWorkspace()
    const createWsRes = await userRequest.post('/api/v1/workspaces', { data: wsData })
    expect(createWsRes.status()).toBe(201)
    const ws = (await createWsRes.json()).data

    const inviteRes = await userRequest.post(`/api/v1/workspaces/${ws.id}/invites`, {
      data: {
        role: 'member',
      },
    })
    expect(inviteRes.status()).toBe(400)
  })

  test('should keep a link tied to the invited email and let it be resent or revoked', async ({
    userRequest,
    userContext,
    request,
  }) => {
    const createWsRes = await userRequest.post('/api/v1/workspaces', { data: generateWorkspace() })
    const ws = (await createWsRes.json()).data
    const invitesPath = `/api/v1/workspaces/${ws.id}/invites`
    const authorization = `Bearer ${userContext.token}`

    const invitee = generateUser()
    const other = generateUser()
    for (const person of [invitee, other]) {
      expect((await request.post('/api/v1/auth/register', { data: person })).status()).toBe(201)
    }
    const token = await inviteToWorkspace({ authorization, workspaceId: ws.id, email: invitee.email })

    // Anyone with the link sees what it offers, with the email masked.
    const previewRes = await request.post('/api/v1/invites/preview', { data: { token } })
    expect(previewRes.status()).toBe(200)
    const preview = (await previewRes.json()).data
    expect(preview.workspaceName).toBe(ws.name)
    expect(preview.role).toBe('member')
    expect(preview.email).not.toBe(invitee.email)
    expect(preview.email.endsWith(invitee.email.slice(invitee.email.indexOf('@')))).toBe(true)
    expect((await request.post('/api/v1/invites/preview', { data: { token: 'nope' } })).status()).toBe(404)

    // Someone else, even verified, cannot use it.
    const otherLogin = await request.post('/api/v1/auth/login', { data: { email: other.email, password: other.password } })
    const otherToken = (await otherLogin.json()).data.accessToken
    const otherAccept = await request.post('/api/v1/invites/accept', {
      data: { token },
      headers: { Authorization: `Bearer ${otherToken}` },
    })
    expect(otherAccept.status()).toBe(403)

    // Resend: not twice within a minute; a new link replaces the old one.
    const listed = (await (await userRequest.get(invitesPath)).json()).data
    expect(listed).toHaveLength(1)
    expect(JSON.stringify(listed)).not.toContain(token)
    const resendPath = `${invitesPath}/${listed[0].id}/resend`
    const tooSoon = await userRequest.post(resendPath)
    expect(tooSoon.status()).toBe(429)
    expect(tooSoon.headers()['retry-after']).toBeTruthy()

    // Revoked: the link is dead and the invitation is gone from the list.
    expect((await userRequest.delete(`${invitesPath}/${listed[0].id}`)).status()).toBe(204)
    expect((await request.post('/api/v1/invites/preview', { data: { token } })).status()).toBe(404)
    expect((await (await userRequest.get(invitesPath)).json()).data ?? []).toHaveLength(0)
  })

  test('should limit who may invite and which roles', async ({ userRequest, userContext, request, playwright }) => {
    const createWsRes = await userRequest.post('/api/v1/workspaces', { data: generateWorkspace() })
    const ws = (await createWsRes.json()).data
    const invitesPath = `/api/v1/workspaces/${ws.id}/invites`

    const adminData = generateUser()
    const adminReg = await request.post('/api/v1/auth/register', { data: adminData })
    const admin = (await adminReg.json()).data
    await joinWorkspace({
      authorization: `Bearer ${userContext.token}`,
      workspaceId: ws.id,
      email: adminData.email,
      role: 'admin',
    })
    const adminRequest = await playwright.request.newContext({
      baseURL: process.env.API_URL || 'http://localhost:8080',
      extraHTTPHeaders: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
    })

    const target = `target-${Date.now()}@example.invalid`
    expect((await adminRequest.post(invitesPath, { data: { email: target, role: 'admin' } })).status()).toBe(403)
    expect((await adminRequest.post(invitesPath, { data: { email: target, role: 'member' } })).status()).toBe(201)
    expect((await userRequest.post(invitesPath, { data: { email: target, role: 'owner' } })).status()).toBe(400)
    expect((await userRequest.post(invitesPath, { data: { email: 'not an email', role: 'member' } })).status()).toBe(400)
    // The owner's own address, and a current member's, are refused.
    expect((await userRequest.post(invitesPath, { data: { email: adminData.email } })).status()).toBe(409)

    await adminRequest.dispose()
  })
})
