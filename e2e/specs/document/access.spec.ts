import { test, expect } from '../../fixtures/test-base'
import { generateDocument, generateUser, generateWorkspace } from '../../helpers/factory'

test.describe('Document: Collaborator Access Control', () => {
  test('should manage collaborator access: list, add, update, and revoke', async ({
    userRequest,
    userContext,
    request,
    playwright,
  }) => {
    // 1. Setup Workspace & User A (Owner)
    const wsRes = await userRequest.post('/api/v1/workspaces', { data: generateWorkspace() })
    const workspace = (await wsRes.json()).data

    const wsRequestA = await playwright.request.newContext({
      baseURL: process.env.API_URL || 'http://localhost:8080',
      extraHTTPHeaders: {
        Authorization: `Bearer ${userContext.token}`,
        'X-Workspace-Id': workspace.id,
        'Content-Type': 'application/json',
      },
    })

    // 2. User A creates document
    const createDocRes = await wsRequestA.post('/api/v1/documents', {
      data: generateDocument('Collaboration Specs'),
    })
    expect(createDocRes.status()).toBe(201)
    const doc = (await createDocRes.json()).data
    const docId = doc.id

    // 3. User A lists accesses (creator has owner access)
    const initialAccRes = await wsRequestA.get(`/api/v1/documents/${docId}/accesses`)
    expect(initialAccRes.status()).toBe(200)
    const initialAcc = (await initialAccRes.json()).data
    expect(initialAcc.length).toBe(1)
    expect(initialAcc[0].userId).toBe(userContext.user.id)
    expect(initialAcc[0].accessLevel).toBe('owner')

    // 4. Register User B and add to workspace
    const userBData = generateUser()
    const regBRes = await request.post('/api/v1/auth/register', { data: userBData })
    const userB = (await regBRes.json()).data

    await userRequest.post(`/api/v1/workspaces/${workspace.id}/invites`, {
      data: { email: userBData.email, role: 'member' },
    })

    // 5. User A adds User B as 'edit' collaborator
    const addAccRes = await wsRequestA.post(`/api/v1/documents/${docId}/accesses`, {
      data: {
        email: userBData.email,
        level: 'edit',
      },
    })
    expect(addAccRes.status()).toBe(201)

    // 6. Verify accesses now has 2 entries
    const twoAccRes = await wsRequestA.get(`/api/v1/documents/${docId}/accesses`)
    const twoAcc = (await twoAccRes.json()).data
    expect(twoAcc.length).toBe(2)
    const accB = twoAcc.find((a: { userId: string }) => a.userId === userB.user.id)
    expect(accB).toBeDefined()
    expect(accB.accessLevel).toBe('edit')

    // 7. Update User B's level to 'view'
    await wsRequestA.post(`/api/v1/documents/${docId}/accesses`, {
      data: {
        email: userBData.email,
        level: 'view',
      },
    })

    const afterUpdateRes = await wsRequestA.get(`/api/v1/documents/${docId}/accesses`)
    const afterUpdate = (await afterUpdateRes.json()).data
    const updatedB = afterUpdate.find((a: { userId: string }) => a.userId === userB.user.id)
    expect(updatedB.accessLevel).toBe('view')

    // 8. Revoke User B's access
    const removeAccRes = await wsRequestA.delete(`/api/v1/documents/${docId}/accesses/${userB.user.id}`)
    expect(removeAccRes.status()).toBe(200)

    // Verify 1 access remains
    const finalAccRes = await wsRequestA.get(`/api/v1/documents/${docId}/accesses`)
    const finalAcc = (await finalAccRes.json()).data
    expect(finalAcc.length).toBe(1)
    expect(finalAcc.find((a: { userId: string }) => a.userId === userB.user.id)).toBeUndefined()

    await wsRequestA.dispose()
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

    const createDocRes = await wsRequest.post('/api/v1/documents', {
      data: generateDocument('Access 404 Test'),
    })
    const doc = (await createDocRes.json()).data

    const addRes = await wsRequest.post(`/api/v1/documents/${doc.id}/accesses`, {
      data: { email: 'phantom-collaborator-404@example.com', level: 'edit' },
    })
    expect(addRes.status()).toBe(404)

    await wsRequest.dispose()
  })
})
