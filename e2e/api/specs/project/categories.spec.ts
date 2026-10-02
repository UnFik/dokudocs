import { test, expect } from '../../fixtures/test-base'
import { generateCategory, generateProject, generateUser, generateWorkspace } from '../../helpers/factory'

test.describe('Project: Categories Management', () => {
  test('project viewers can read categories but cannot mutate them', async ({
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

    const viewerData = generateUser()
    const registerRes = await request.post('/api/v1/auth/register', { data: viewerData })
    expect(registerRes.status()).toBe(201)
    const viewer = (await registerRes.json()).data
    const inviteRes = await userRequest.post(`/api/v1/workspaces/${workspace.id}/invites`, {
      data: { email: viewerData.email, role: 'member' },
    })
    expect(inviteRes.status()).toBe(201)

    const projectRes = await ownerRequest.post('/api/v1/projects', {
      data: { ...generateProject('Private Category Viewer'), visibility: 'private' },
    })
    expect(projectRes.status()).toBe(201)
    const project = (await projectRes.json()).data
    const addMemberRes = await ownerRequest.post(`/api/v1/projects/${project.id}/members`, {
      data: { email: viewerData.email, role: 'viewer' },
    })
    expect(addMemberRes.status()).toBe(201)

    const viewerRequest = await playwright.request.newContext({
      baseURL: process.env.API_URL || 'http://localhost:8080',
      extraHTTPHeaders: {
        Authorization: `Bearer ${viewer.accessToken}`,
        'X-Workspace-Id': workspace.id,
        'Content-Type': 'application/json',
      },
    })
    const listRes = await viewerRequest.get(`/api/v1/projects/${project.id}/categories`)
    expect(listRes.status()).toBe(200)
    const originalCategories = (await listRes.json()).data
    expect(originalCategories.length).toBeGreaterThan(1)
    const originalIds = originalCategories.map((category: { id: string }) => category.id)

    const addRes = await viewerRequest.post(`/api/v1/projects/${project.id}/categories`, {
      data: generateCategory('Viewer must not add'),
    })
    expect(addRes.status()).toBe(403)

    const updateRes = await viewerRequest.put(
      `/api/v1/projects/${project.id}/categories/${originalIds[0]}`,
      { data: { name: 'Viewer must not rename', colorId: 'red' } },
    )
    expect(updateRes.status()).toBe(403)

    const reorderRes = await viewerRequest.put(`/api/v1/projects/${project.id}/categories/reorder`, {
      data: { categoryIds: [...originalIds].reverse() },
    })
    expect(reorderRes.status()).toBe(403)

    const deleteRes = await viewerRequest.delete(
      `/api/v1/projects/${project.id}/categories/${originalIds[1]}`,
    )
    expect(deleteRes.status()).toBe(403)

    const afterRes = await ownerRequest.get(`/api/v1/projects/${project.id}/categories`)
    expect(afterRes.status()).toBe(200)
    const afterCategories = (await afterRes.json()).data
    expect(afterCategories.map((category: { id: string }) => category.id)).toEqual(originalIds)

    const promoteRes = await ownerRequest.post(`/api/v1/projects/${project.id}/members`, {
      data: { email: viewerData.email, role: 'editor' },
    })
    expect(promoteRes.status()).toBe(201)

    const editorAddRes = await viewerRequest.post(`/api/v1/projects/${project.id}/categories`, {
      data: generateCategory('Editor can add'),
    })
    expect(editorAddRes.status()).toBe(201)
    const addedCategory = (await editorAddRes.json()).data
    const editorUpdateRes = await viewerRequest.put(
      `/api/v1/projects/${project.id}/categories/${originalIds[0]}`,
      { data: { name: 'Editor can rename', colorId: 'emerald' } },
    )
    expect(editorUpdateRes.status()).toBe(200)

    const currentRes = await viewerRequest.get(`/api/v1/projects/${project.id}/categories`)
    const currentCategories = (await currentRes.json()).data
    const reorderedIds = currentCategories
      .map((category: { id: string }) => category.id)
      .reverse()
    const editorReorderRes = await viewerRequest.put(`/api/v1/projects/${project.id}/categories/reorder`, {
      data: { categoryIds: reorderedIds },
    })
    expect(editorReorderRes.status()).toBe(200)

    const editorDeleteRes = await viewerRequest.delete(
      `/api/v1/projects/${project.id}/categories/${addedCategory.id}`,
    )
    expect(editorDeleteRes.status()).toBe(200)
    const finalRes = await ownerRequest.get(`/api/v1/projects/${project.id}/categories`)
    const finalCategories = (await finalRes.json()).data
    expect(finalCategories.map((category: { id: string }) => category.id)).toEqual(
      reorderedIds.filter((id: string) => id !== addedCategory.id),
    )
    expect(finalCategories.find((category: { id: string }) => category.id === originalIds[0]).name).toBe(
      'Editor can rename',
    )

    await viewerRequest.dispose()
    await ownerRequest.dispose()
  })

  test('should manage categories: list, add, update, reorder, and delete', async ({
    userRequest,
    userContext,
    playwright,
  }) => {
    // 1. Setup Workspace & Project
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

    const projectData = generateProject('Category Test')
    const createRes = await wsRequest.post('/api/v1/projects', { data: projectData })
    expect(createRes.status()).toBe(201)
    const project = (await createRes.json()).data
    const projectId = project.id

    // 2. List initial categories (General, API, Docs)
    const listRes = await wsRequest.get(`/api/v1/projects/${projectId}/categories`)
    expect(listRes.status()).toBe(200)
    const initialCats = (await listRes.json()).data
    expect(initialCats.length).toBe(3)
    const catNames = initialCats.map((c: { name: string }) => c.name)
    expect(catNames).toEqual(expect.arrayContaining(['General', 'API', 'Docs']))

    // 3. Add a new category
    const newCatData = generateCategory('Database')
    const addRes = await wsRequest.post(`/api/v1/projects/${projectId}/categories`, {
      data: newCatData,
    })
    expect(addRes.status()).toBe(201)
    const addedCat = (await addRes.json()).data
    expect(addedCat.name).toBe(newCatData.name)
    expect(addedCat.colorId).toBe(newCatData.colorId)
    const addedCatId = addedCat.id

    // Verify list has 4 categories now
    const afterAddRes = await wsRequest.get(`/api/v1/projects/${projectId}/categories`)
    const afterAddCats = (await afterAddRes.json()).data
    expect(afterAddCats.length).toBe(4)

    // 4. Update Category (Rename & Change Color)
    const updateRes = await wsRequest.put(`/api/v1/projects/${projectId}/categories/${addedCatId}`, {
      data: {
        name: 'Database Schema Updated',
        colorId: 'emerald',
      },
    })
    expect(updateRes.status()).toBe(200)

    // 5. Reorder Categories
    const currentOrderIds = afterAddCats.map((c: { id: string }) => c.id)
    const reversedOrderIds = [...currentOrderIds].reverse()
    const reorderRes = await wsRequest.put(`/api/v1/projects/${projectId}/categories/reorder`, {
      data: {
        categoryIds: reversedOrderIds,
      },
    })
    expect(reorderRes.status()).toBe(200)

    // Verify new sort order
    const afterReorderRes = await wsRequest.get(`/api/v1/projects/${projectId}/categories`)
    const afterReorderCats = (await afterReorderRes.json()).data
    const afterReorderIds = afterReorderCats.map((c: { id: string }) => c.id)
    expect(afterReorderIds).toEqual(reversedOrderIds)

    // 6. Delete Category
    const deleteRes = await wsRequest.delete(`/api/v1/projects/${projectId}/categories/${addedCatId}`)
    expect(deleteRes.status()).toBe(200)

    // Verify deleted category is removed
    const finalListRes = await wsRequest.get(`/api/v1/projects/${projectId}/categories`)
    const finalCats = (await finalListRes.json()).data
    expect(finalCats.length).toBe(3)
    const foundDeleted = finalCats.find((c: { id: string }) => c.id === addedCatId)
    expect(foundDeleted).toBeUndefined()

    await wsRequest.dispose()
  })

  test('should reject adding category with empty name with 400 Bad Request', async ({
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

    const createRes = await wsRequest.post('/api/v1/projects', { data: generateProject('Empty Cat') })
    const project = (await createRes.json()).data

    const addRes = await wsRequest.post(`/api/v1/projects/${project.id}/categories`, {
      data: { name: '', colorId: 'red' },
    })
    expect(addRes.status()).toBe(400)

    await wsRequest.dispose()
  })
})
