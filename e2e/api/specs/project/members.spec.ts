import { test, expect } from '../../fixtures/test-base'
import { generateProject, generateUser, generateWorkspace } from '../../helpers/factory'

test.describe('Project: Members Management', () => {
  test('should manage project members: list, add, update role, and remove', async ({
    userRequest,
    userContext,
    request,
    playwright,
  }) => {
    // 1. Create Workspace with User A (Owner)
    const wsRes = await userRequest.post('/api/v1/workspaces', { data: generateWorkspace() })
    expect(wsRes.status()).toBe(201)
    const workspace = (await wsRes.json()).data

    const wsRequestA = await playwright.request.newContext({
      baseURL: process.env.API_URL || 'http://localhost:8080',
      extraHTTPHeaders: {
        Authorization: `Bearer ${userContext.token}`,
        'X-Workspace-Id': workspace.id,
        'Content-Type': 'application/json',
      },
    })

    // 2. User A creates Project
    const projectData = { ...generateProject('Member Test Project'), visibility: 'private' }
    const createRes = await wsRequestA.post('/api/v1/projects', { data: projectData })
    expect(createRes.status()).toBe(201)
    const project = (await createRes.json()).data
    const projectId = project.id

    // 3. Verify initial member list has User A as manager
    const initialMembersRes = await wsRequestA.get(`/api/v1/projects/${projectId}/members`)
    expect(initialMembersRes.status()).toBe(200)
    const initialMembers = (await initialMembersRes.json()).data
    expect(initialMembers.length).toBe(1)
    expect(initialMembers[0].userId).toBe(userContext.user.id)
    expect(initialMembers[0].role).toBe('manager')
    expect(initialMembers[0].user).toBeDefined()
    expect(initialMembers[0].user.email).toBe(userContext.user.email)

    // 4. Register User B and add to Workspace first
    const userBData = generateUser()
    const regBRes = await request.post('/api/v1/auth/register', { data: userBData })
    expect(regBRes.status()).toBe(201)
    const userB = (await regBRes.json()).data

    const addWsMemberRes = await userRequest.post(`/api/v1/workspaces/${workspace.id}/invites`, {
      data: { email: userBData.email, role: 'member' },
    })
    expect(addWsMemberRes.status()).toBe(201)

    const userBRequest = await playwright.request.newContext({
      baseURL: process.env.API_URL || 'http://localhost:8080',
      extraHTTPHeaders: {
        Authorization: `Bearer ${userB.accessToken}`,
        'X-Workspace-Id': workspace.id,
        'Content-Type': 'application/json',
      },
    })

    // 5. User A adds User B to Project as 'editor'
    const addProjMemberRes = await wsRequestA.post(`/api/v1/projects/${projectId}/members`, {
      data: {
        email: userBData.email,
        role: 'editor',
      },
    })
    expect(addProjMemberRes.status()).toBe(201)

    // 6. Verify member list now has 2 members
    const twoMembersRes = await wsRequestA.get(`/api/v1/projects/${projectId}/members`)
    expect(twoMembersRes.status()).toBe(200)
    const twoMembers = (await twoMembersRes.json()).data
    expect(twoMembers.length).toBe(2)
    const memberB = twoMembers.find((m: { userId: string }) => m.userId === userB.user.id)
    expect(memberB).toBeDefined()
    expect(memberB.role).toBe('editor')

    const userCData = generateUser()
    const regCRes = await request.post('/api/v1/auth/register', { data: userCData })
    expect(regCRes.status()).toBe(201)
    const userC = (await regCRes.json()).data
    const addWsMemberCRes = await userRequest.post(`/api/v1/workspaces/${workspace.id}/invites`, {
      data: { email: userCData.email, role: 'member' },
    })
    expect(addWsMemberCRes.status()).toBe(201)

    const editorAddRes = await userBRequest.post(`/api/v1/projects/${projectId}/members`, {
      data: { email: userCData.email, role: 'viewer' },
    })
    expect(editorAddRes.status()).toBe(403)
    const editorUpdateRes = await userBRequest.post(`/api/v1/projects/${projectId}/members`, {
      data: { email: userBData.email, role: 'manager' },
    })
    expect(editorUpdateRes.status()).toBe(403)
    const editorRemoveRes = await userBRequest.delete(
      `/api/v1/projects/${projectId}/members/${userC.user.id}`,
    )
    expect(editorRemoveRes.status()).toBe(403)

    const unchangedRosterRes = await wsRequestA.get(`/api/v1/projects/${projectId}/members`)
    const unchangedRoster = (await unchangedRosterRes.json()).data
    expect(unchangedRoster.map((member: { userId: string }) => member.userId).sort()).toEqual(
      [userContext.user.id, userB.user.id].sort(),
    )

    // 7. Update User B's role to 'viewer'
    const updateRoleRes = await wsRequestA.post(`/api/v1/projects/${projectId}/members`, {
      data: {
        email: userBData.email,
        role: 'viewer',
      },
    })
    expect(updateRoleRes.status()).toBe(201)

    // Verify role updated
    const afterUpdateRes = await wsRequestA.get(`/api/v1/projects/${projectId}/members`)
    const afterUpdateMembers = (await afterUpdateRes.json()).data
    const updatedB = afterUpdateMembers.find((m: { userId: string }) => m.userId === userB.user.id)
    expect(updatedB.role).toBe('viewer')

    // 8. Remove User B from Project
    const removeRes = await wsRequestA.delete(`/api/v1/projects/${projectId}/members/${userB.user.id}`)
    expect(removeRes.status()).toBe(200)

    // Verify User B is removed
    const finalMembersRes = await wsRequestA.get(`/api/v1/projects/${projectId}/members`)
    const finalMembers = (await finalMembersRes.json()).data
    expect(finalMembers.length).toBe(1)
    const removedB = finalMembers.find((m: { userId: string }) => m.userId === userB.user.id)
    expect(removedB).toBeUndefined()

    await wsRequestA.dispose()
    await userBRequest.dispose()
  })

  test('should reject adding non-existent user with 404 Not Found', async ({
    userRequest,
    userContext,
    playwright,
  }) => {
    const wsRes = await userRequest.post('/api/v1/workspaces', { data: generateWorkspace() })
    const workspace = (await wsRes.json()).data

    const wsRequest = await playwright.request.newContext({
      baseURL: process.env.API_URL || 'http://localhost:8080',
      extraHTTPHeaders: {
        Authorization: `Bearer ${userContext.token}`,
        'X-Workspace-Id': workspace.id,
        'Content-Type': 'application/json',
      },
    })

    const createRes = await wsRequest.post('/api/v1/projects', { data: generateProject('Non-Existent User Test') })
    const project = (await createRes.json()).data

    const addRes = await wsRequest.post(`/api/v1/projects/${project.id}/members`, {
      data: { email: 'phantom-user-404@example.com', role: 'editor' },
    })
    expect(addRes.status()).toBe(404)

    await wsRequest.dispose()
  })

  test('should reject adding user who is not a workspace member with 400 Bad Request', async ({
    userRequest,
    userContext,
    request,
    playwright,
  }) => {
    const wsRes = await userRequest.post('/api/v1/workspaces', { data: generateWorkspace() })
    const workspace = (await wsRes.json()).data

    const wsRequest = await playwright.request.newContext({
      baseURL: process.env.API_URL || 'http://localhost:8080',
      extraHTTPHeaders: {
        Authorization: `Bearer ${userContext.token}`,
        'X-Workspace-Id': workspace.id,
        'Content-Type': 'application/json',
      },
    })

    const createRes = await wsRequest.post('/api/v1/projects', { data: generateProject('Foreign User Test') })
    const project = (await createRes.json()).data

    // Register User C but DO NOT add User C to workspace
    const userCData = generateUser()
    const regCRes = await request.post('/api/v1/auth/register', { data: userCData })
    expect(regCRes.status()).toBe(201)

    const addRes = await wsRequest.post(`/api/v1/projects/${project.id}/members`, {
      data: { email: userCData.email, role: 'editor' },
    })
    expect(addRes.status()).toBe(400)

    await wsRequest.dispose()
  })
})
