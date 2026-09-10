import { test, expect } from '../../fixtures/test-base'
import { generateCategory, generateProject, generateWorkspace } from '../../helpers/factory'

test.describe('Project: Categories Management', () => {
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
