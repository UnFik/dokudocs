import { test, expect } from '../../fixtures/test-base'
import { generateDocument, generateWorkspace } from '../../helpers/factory'

test.describe('Document: Trash Management', () => {
  test('should soft delete, list in trash, restore, and permanent delete', async ({
    userRequest,
    userContext,
    playwright,
  }) => {
    // 1. Setup Workspace
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

    // 2. Create Document
    const createDocRes = await wsRequest.post('/api/v1/documents', {
      data: generateDocument('Document for Trash'),
    })
    expect(createDocRes.status()).toBe(201)
    const doc = (await createDocRes.json()).data
    const docId = doc.id

    // 3. Move Document to Trash (Soft Delete)
    const trashRes = await wsRequest.delete(`/api/v1/documents/${docId}`)
    expect(trashRes.status()).toBe(200)

    // Verify it is excluded from active documents list
    const activeDocsRes = await wsRequest.get('/api/v1/documents')
    const activeDocs = (await activeDocsRes.json()).data
    expect(activeDocs.find((d: { id: string }) => d.id === docId)).toBeUndefined()

    // 4. List Trash
    const listTrashRes = await wsRequest.get('/api/v1/trash')
    expect(listTrashRes.status()).toBe(200)
    const trashItems = (await listTrashRes.json()).data
    expect(Array.isArray(trashItems)).toBe(true)
    const trashed = trashItems.find((t: { docId: string }) => t.docId === docId)
    expect(trashed).toBeDefined()
    expect(trashed.daysRemaining).toBeGreaterThanOrEqual(29)
    expect(trashed.deletedBy.email).toBe(userContext.user.email)

    // 5. Restore Document
    const restoreRes = await wsRequest.post(`/api/v1/documents/${docId}/restore`)
    expect(restoreRes.status()).toBe(200)

    // Verify it reappears in active documents
    const checkRestoredRes = await wsRequest.get('/api/v1/documents')
    const checkRestored = (await checkRestoredRes.json()).data
    expect(checkRestored.find((d: { id: string }) => d.id === docId)).toBeDefined()

    // Verify it is removed from trash
    const checkTrashAfterRestore = await wsRequest.get('/api/v1/trash')
    const trashAfterRestore = (await checkTrashAfterRestore.json()).data
    expect(trashAfterRestore.find((t: { docId: string }) => t.docId === docId)).toBeUndefined()

    // 6. Permanent Delete
    // Soft delete again first
    await wsRequest.delete(`/api/v1/documents/${docId}`)
    const permDeleteRes = await wsRequest.delete(`/api/v1/documents/${docId}/permanent`)
    expect(permDeleteRes.status()).toBe(200)

    // Verify completely gone
    const finalTrashRes = await wsRequest.get('/api/v1/trash')
    const finalTrash = (await finalTrashRes.json()).data
    expect(finalTrash.find((t: { docId: string }) => t.docId === docId)).toBeUndefined()

    await wsRequest.dispose()
  })

  test('should empty trash permanently removing all trashed documents', async ({
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

    // Create 2 docs and move to trash
    const docRes1 = await wsRequest.post('/api/v1/documents', { data: generateDocument('Trash Batch 1') })
    const docRes2 = await wsRequest.post('/api/v1/documents', { data: generateDocument('Trash Batch 2') })
    const doc1 = (await docRes1.json()).data
    const doc2 = (await docRes2.json()).data

    await wsRequest.delete(`/api/v1/documents/${doc1.id}`)
    await wsRequest.delete(`/api/v1/documents/${doc2.id}`)

    const beforeEmpty = await wsRequest.get('/api/v1/trash')
    expect((await beforeEmpty.json()).data.length).toBe(2)

    // Empty trash
    const emptyRes = await wsRequest.delete('/api/v1/trash')
    expect(emptyRes.status()).toBe(200)

    // Verify trash is empty
    const afterEmpty = await wsRequest.get('/api/v1/trash')
    expect((await afterEmpty.json()).data.length).toBe(0)

    await wsRequest.dispose()
  })
})
