import { randomUUID } from 'node:crypto'
import { test, expect } from '../../fixtures/test-base'
import { generateDocument, generateUser, generateWorkspace } from '../../helpers/factory'

test.describe('Document: Trash Management', () => {
  test('does not expose workspace-visible trash metadata to ordinary members', async ({
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

    const memberData = generateUser()
    const registerRes = await request.post('/api/v1/auth/register', { data: memberData })
    expect(registerRes.status()).toBe(201)
    const member = (await registerRes.json()).data
    const inviteRes = await userRequest.post(`/api/v1/workspaces/${workspace.id}/invites`, {
      data: { email: memberData.email, role: 'member' },
    })
    expect(inviteRes.ok()).toBeTruthy()
    const memberRequest = await playwright.request.newContext({
      baseURL: process.env.API_URL || 'http://localhost:8080',
      extraHTTPHeaders: {
        Authorization: `Bearer ${member.accessToken}`,
        'X-Workspace-Id': workspace.id,
        'Content-Type': 'application/json',
      },
    })

    const createRes = await ownerRequest.post('/api/v1/documents', {
      headers: { 'Idempotency-Key': randomUUID() },
      data: { ...generateDocument('Workspace visible trashed'), visibility: 'workspace' },
    })
    expect(createRes.status()).toBe(201)
    const document = (await createRes.json()).data
    expect((await ownerRequest.delete(`/api/v1/documents/${document.id}`)).status()).toBe(200)

    const trashRes = await memberRequest.get('/api/v1/trash')
    expect(trashRes.status()).toBe(200)
    expect((await trashRes.json()).data).toEqual([])

    await memberRequest.dispose()
    await ownerRequest.dispose()
  })

  test('edit access can trash a document but cannot inspect or restore its trash entry', async ({
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

    const editorData = generateUser()
    const registerRes = await request.post('/api/v1/auth/register', { data: editorData })
    expect(registerRes.status()).toBe(201)
    const editor = (await registerRes.json()).data
    const inviteRes = await userRequest.post(`/api/v1/workspaces/${workspace.id}/invites`, {
      data: { email: editorData.email, role: 'member' },
    })
    expect(inviteRes.status()).toBe(201)
    const editorRequest = await playwright.request.newContext({
      baseURL: process.env.API_URL || 'http://localhost:8080',
      extraHTTPHeaders: {
        Authorization: `Bearer ${editor.accessToken}`,
        'X-Workspace-Id': workspace.id,
        'Content-Type': 'application/json',
      },
    })

    const createRes = await ownerRequest.post('/api/v1/documents', {
      headers: { 'Idempotency-Key': randomUUID() },
      data: { ...generateDocument('Editor trashed document'), visibility: 'private' },
    })
    expect(createRes.status()).toBe(201)
    const document = (await createRes.json()).data
    const grantRes = await ownerRequest.post(`/api/v1/documents/${document.id}/accesses`, {
      data: { email: editorData.email, level: 'edit' },
    })
    expect(grantRes.status()).toBe(201)

    expect((await editorRequest.delete(`/api/v1/documents/${document.id}`)).status()).toBe(200)
    const editorTrash = await editorRequest.get('/api/v1/trash')
    expect(editorTrash.status()).toBe(200)
    expect((await editorTrash.json()).data).toEqual([])
    expect((await editorRequest.post(`/api/v1/documents/${document.id}/restore`)).status()).toBe(403)
    expect((await editorRequest.delete(`/api/v1/documents/${document.id}/permanent`)).status()).toBe(403)

    const ownerTrash = await ownerRequest.get('/api/v1/trash')
    expect((await ownerTrash.json()).data.some((item: { docId: string }) => item.docId === document.id)).toBe(true)
    expect((await ownerRequest.post(`/api/v1/documents/${document.id}/restore`)).status()).toBe(200)

    await editorRequest.dispose()
    await ownerRequest.dispose()
  })

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
      headers: { 'Idempotency-Key': randomUUID() },
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
    const docRes1 = await wsRequest.post('/api/v1/documents', {
      headers: { 'Idempotency-Key': randomUUID() },
      data: generateDocument('Trash Batch 1'),
    })
    const docRes2 = await wsRequest.post('/api/v1/documents', {
      headers: { 'Idempotency-Key': randomUUID() },
      data: generateDocument('Trash Batch 2'),
    })
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
