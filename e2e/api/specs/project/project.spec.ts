import { test, expect } from '../../fixtures/test-base'
import { generateProject, generateUser, generateWorkspace } from '../../helpers/factory'

test.describe('Project: CRUD & Star /api/v1/projects', () => {
  test('private project readers can star it but cannot edit or delete it', async ({
    userRequest,
    userContext,
    request,
    playwright,
  }) => {
    const workspaceRes = await userRequest.post('/api/v1/workspaces', { data: generateWorkspace() })
    expect(workspaceRes.status()).toBe(201)
    const workspace = (await workspaceRes.json()).data
    const ownerRequest = await playwright.request.newContext({
      baseURL: process.env.API_URL || 'http://localhost:8080',
      extraHTTPHeaders: {
        Authorization: `Bearer ${userContext.token}`,
        'X-Workspace-Id': workspace.id,
        'Content-Type': 'application/json',
      },
    })

    const readerData = generateUser()
    const registerRes = await request.post('/api/v1/auth/register', { data: readerData })
    expect(registerRes.status()).toBe(201)
    const reader = (await registerRes.json()).data
    const inviteRes = await userRequest.post(`/api/v1/workspaces/${workspace.id}/invites`, {
      data: { email: readerData.email, role: 'member' },
    })
    expect(inviteRes.status()).toBe(201)

    const projectRes = await ownerRequest.post('/api/v1/projects', {
      data: { ...generateProject('Private project read access'), visibility: 'private' },
    })
    expect(projectRes.status()).toBe(201)
    const project = (await projectRes.json()).data
    const memberRes = await ownerRequest.post(`/api/v1/projects/${project.id}/members`, {
      data: { email: readerData.email, role: 'viewer' },
    })
    expect(memberRes.status()).toBe(201)

    const readerRequest = await playwright.request.newContext({
      baseURL: process.env.API_URL || 'http://localhost:8080',
      extraHTTPHeaders: {
        Authorization: `Bearer ${reader.accessToken}`,
        'X-Workspace-Id': workspace.id,
        'Content-Type': 'application/json',
      },
    })
    const getRes = await readerRequest.get(`/api/v1/projects/${project.id}`)
    expect(getRes.status()).toBe(200)

    const updateRes = await readerRequest.put(`/api/v1/projects/${project.id}`, {
      data: { name: 'Reader must not rename', visibility: 'workspace' },
    })
    expect(updateRes.status()).toBe(403)
    const deleteRes = await readerRequest.delete(`/api/v1/projects/${project.id}`)
    expect(deleteRes.status()).toBe(403)
    const starRes = await readerRequest.post(`/api/v1/projects/${project.id}/star`)
    expect(starRes.status()).toBe(200)
    expect((await starRes.json()).data.isStarred).toBe(true)

    const unchangedRes = await ownerRequest.get(`/api/v1/projects/${project.id}`)
    expect((await unchangedRes.json()).data.name).toBe(project.name)
    const promoteRes = await ownerRequest.post(`/api/v1/projects/${project.id}/members`, {
      data: { email: readerData.email, role: 'manager' },
    })
    expect(promoteRes.status()).toBe(201)
    const managerUpdateRes = await readerRequest.put(`/api/v1/projects/${project.id}`, {
      data: { name: 'Manager may rename' },
    })
    expect(managerUpdateRes.status()).toBe(200)
    const managerDeleteRes = await readerRequest.delete(`/api/v1/projects/${project.id}`)
    expect(managerDeleteRes.status()).toBe(200)

    await readerRequest.dispose()
    await ownerRequest.dispose()
  })

  test('should perform full project lifecycle: create, list, read, update, star, soft delete', async ({
    userRequest,
    userContext,
    playwright,
  }) => {
    // 1. Create Workspace
    const wsRes = await userRequest.post('/api/v1/workspaces', { data: generateWorkspace() })
    expect(wsRes.status()).toBe(201)
    const workspace = (await wsRes.json()).data

    // Create client context with X-Workspace-Id
    const wsRequest = await playwright.request.newContext({
      baseURL: process.env.API_URL || 'http://localhost:8080',
      extraHTTPHeaders: {
        Authorization: `Bearer ${userContext.token}`,
        'X-Workspace-Id': workspace.id,
        'Content-Type': 'application/json',
      },
    })

    // 2. Create Project
    const projectData = generateProject('Core Service')
    const createRes = await wsRequest.post('/api/v1/projects', {
      data: projectData,
    })
    expect(createRes.status()).toBe(201)
    const project = (await createRes.json()).data

    expect(project.id).toBeDefined()
    expect(project.name).toBe(projectData.name)
    expect(project.description).toBe(projectData.description)
    expect(project.workspaceId).toBe(workspace.id)
    expect(project.colorBadge).toBe(projectData.colorBadge)
    expect(project.role).toBe('manager')
    expect(project.categories).toBeDefined()
    expect(project.categories.length).toBe(3)
    const projectId = project.id

    // 3. List Projects
    const listRes = await wsRequest.get('/api/v1/projects')
    expect(listRes.status()).toBe(200)
    const list = (await listRes.json()).data
    expect(Array.isArray(list)).toBe(true)
    const found = list.find((p: { id: string }) => p.id === projectId)
    expect(found).toBeDefined()
    expect(found.isStarred).toBe(false)
    expect(found.categoryNames).toContain('General')

    // 4. Get Project by ID
    const getRes = await wsRequest.get(`/api/v1/projects/${projectId}`)
    expect(getRes.status()).toBe(200)
    const detail = (await getRes.json()).data
    expect(detail.id).toBe(projectId)
    expect(detail.name).toBe(projectData.name)

    // 5. Update Project
    const updatedName = `${projectData.name} Refactored`
    const updateRes = await wsRequest.put(`/api/v1/projects/${projectId}`, {
      data: {
        name: updatedName,
        description: 'New updated description',
        colorBadge: '#10b981',
      },
    })
    expect(updateRes.status()).toBe(200)
    const updated = (await updateRes.json()).data
    expect(updated.name).toBe(updatedName)
    expect(updated.colorBadge).toBe('#10b981')

    // 6. Toggle Star (Favorite)
    const starRes1 = await wsRequest.post(`/api/v1/projects/${projectId}/star`)
    expect(starRes1.status()).toBe(200)
    const starData1 = (await starRes1.json()).data
    expect(starData1.isStarred).toBe(true)

    // Verify GET reflects isStarred = true
    const checkStarRes = await wsRequest.get(`/api/v1/projects/${projectId}`)
    expect((await checkStarRes.json()).data.isStarred).toBe(true)

    // Unstar
    const starRes2 = await wsRequest.post(`/api/v1/projects/${projectId}/star`)
    expect(starRes2.status()).toBe(200)
    expect((await starRes2.json()).data.isStarred).toBe(false)

    // 7. Soft Delete Project
    const deleteRes = await wsRequest.delete(`/api/v1/projects/${projectId}`)
    expect(deleteRes.status()).toBe(200)

    // 8. Verify Project is no longer in active list
    const finalListRes = await wsRequest.get('/api/v1/projects')
    const finalList = (await finalListRes.json()).data
    const deletedFound = finalList.find((p: { id: string }) => p.id === projectId)
    expect(deletedFound).toBeUndefined()

    // Subsequent GET returns 404
    const verifyGetRes = await wsRequest.get(`/api/v1/projects/${projectId}`)
    expect(verifyGetRes.status()).toBe(404)

    await wsRequest.dispose()
  })

  test('should reject request without X-Workspace-Id with 400 Bad Request', async ({ userRequest }) => {
    const res = await userRequest.get('/api/v1/projects')
    expect(res.status()).toBe(400)
    const json = await res.json()
    expect(json.title || json.message).toMatch(/workspace/i)
  })

  test('should reject request for non-member workspace with 403 Forbidden', async ({ userRequest }) => {
    const res = await userRequest.get('/api/v1/projects', {
      headers: {
        'X-Workspace-Id': '00000000-0000-0000-0000-000000000010', // Seeded workspace where test user is not a member
      },
    })
    expect(res.status()).toBe(403)
  })

  test('should reject creation with empty name with 400 Bad Request', async ({ userRequest, playwright, userContext }) => {
    const wsRes = await userRequest.post('/api/v1/workspaces', { data: generateWorkspace() })
    const workspace = (await wsRes.json()).data

    const wsRequest = await playwright.request.newContext({
      baseURL: process.env.API_URL || 'http://localhost:8080',
      extraHTTPHeaders: {
        Authorization: `Bearer ${userContext.token}`,
        'X-Workspace-Id': workspace.id,
      },
    })

    const res = await wsRequest.post('/api/v1/projects', {
      data: { name: '' },
    })
    expect(res.status()).toBe(400)
    await wsRequest.dispose()
  })
})
