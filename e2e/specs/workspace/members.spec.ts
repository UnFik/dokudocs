import { test, expect } from '../../fixtures/test-base'
import { generateUser, generateWorkspace } from '../../helpers/factory'

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

    // 4. User A invites User B as 'member'
    const inviteRes = await userRequest.post(`/api/v1/workspaces/${workspaceId}/invites`, {
      data: {
        email: userBData.email,
        role: 'member',
      },
    })
    expect(inviteRes.status()).toBe(201)

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

    await userBRequest.dispose()
  })

  test('should return 404 when inviting a non-existent email', async ({ userRequest }) => {
    const wsData = generateWorkspace()
    const createWsRes = await userRequest.post('/api/v1/workspaces', { data: wsData })
    expect(createWsRes.status()).toBe(201)
    const ws = (await createWsRes.json()).data

    const inviteRes = await userRequest.post(`/api/v1/workspaces/${ws.id}/invites`, {
      data: {
        email: 'nobody-does-not-exist@example.com',
        role: 'member',
      },
    })
    expect(inviteRes.status()).toBe(404)
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
})
