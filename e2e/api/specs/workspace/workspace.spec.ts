import { test, expect } from '../../fixtures/test-base'
import { generateUser, generateWorkspace } from '../../helpers/factory'

test.describe('Workspace: CRUD /api/v1/workspaces', () => {
  test('should perform full workspace lifecycle: create, list, read, update, delete', async ({ userRequest, userContext }) => {
    const wsData = generateWorkspace()

    // 1. Create Workspace
    const createRes = await userRequest.post('/api/v1/workspaces', {
      data: wsData,
    })
    expect(createRes.status()).toBe(201)
    const createJson = await createRes.json()
    const workspace = createJson.data || createJson

    expect(workspace.id).toBeDefined()
    expect(workspace.name).toBe(wsData.name)
    expect(workspace.plan).toBe(wsData.plan)
    expect(workspace.logoUrl).toBe(wsData.logoUrl)
    expect(workspace.createdBy).toBe(userContext.user.id)
    const workspaceId = workspace.id

    // 2. List Workspaces (must include new workspace)
    const listRes = await userRequest.get('/api/v1/workspaces')
    expect(listRes.status()).toBe(200)
    const listJson = await listRes.json()
    const workspaces = listJson.data || listJson
    expect(Array.isArray(workspaces)).toBe(true)
    const found = workspaces.find((w: { id: string }) => w.id === workspaceId)
    expect(found).toBeDefined()
    expect(found.name).toBe(wsData.name)

    // 3. Get Workspace by ID
    const getRes = await userRequest.get(`/api/v1/workspaces/${workspaceId}`)
    expect(getRes.status()).toBe(200)
    const getJson = await getRes.json()
    const detail = getJson.data || getJson
    expect(detail.id).toBe(workspaceId)
    expect(detail.name).toBe(wsData.name)

    // 4. Update Workspace
    const updatedName = `${wsData.name} Updated`
    const updateRes = await userRequest.put(`/api/v1/workspaces/${workspaceId}`, {
      data: {
        name: updatedName,
        plan: 'Enterprise',
        logoUrl: 'https://example.com/updated-logo.png',
      },
    })
    expect(updateRes.status()).toBe(200)
    const updateJson = await updateRes.json()
    const updated = updateJson.data || updateJson
    expect(updated.name).toBe(updatedName)
    expect(updated.plan).toBe('Enterprise')

    // 5. Delete Workspace (owner permission)
    const deleteRes = await userRequest.delete(`/api/v1/workspaces/${workspaceId}`)
    expect(deleteRes.status()).toBe(200)

    // 6. Verify Workspace is no longer accessible
    const verifyRes = await userRequest.get(`/api/v1/workspaces/${workspaceId}`)
    expect(verifyRes.status()).toBe(404)
  })

  test('should reject workspace creation with empty name with 400 Bad Request', async ({ userRequest }) => {
    const res = await userRequest.post('/api/v1/workspaces', {
      data: {
        name: '',
      },
    })
    expect(res.status()).toBe(400)
  })

  test('should return 404 for non-existent workspace ID', async ({ userRequest }) => {
    const res = await userRequest.get('/api/v1/workspaces/00000000-0000-0000-0000-000000000099')
    expect(res.status()).toBe(404)
  })

  test('should hide workspace details from non-members', async ({ userRequest, request, playwright }) => {
    const workspaceRes = await userRequest.post('/api/v1/workspaces', { data: generateWorkspace() })
    expect(workspaceRes.status()).toBe(201)
    const workspace = (await workspaceRes.json()).data
    const outsiderData = generateUser()
    const outsiderRes = await request.post('/api/v1/auth/register', { data: outsiderData })
    expect(outsiderRes.status()).toBe(201)
    const outsider = (await outsiderRes.json()).data
    const outsiderRequest = await playwright.request.newContext({
      baseURL: process.env.API_URL || 'http://localhost:8080',
      extraHTTPHeaders: { Authorization: `Bearer ${outsider.accessToken}` },
    })

    expect((await outsiderRequest.get(`/api/v1/workspaces/${workspace.id}`)).status()).toBe(404)
    await outsiderRequest.dispose()
  })

  test('should reject unauthenticated workspace operations with 401 Unauthorized', async ({ request }) => {
    const listRes = await request.get('/api/v1/workspaces')
    expect(listRes.status()).toBe(401)

    const createRes = await request.post('/api/v1/workspaces', {
      data: { name: 'Unauthorized Workspace' },
    })
    expect(createRes.status()).toBe(401)
  })
})
