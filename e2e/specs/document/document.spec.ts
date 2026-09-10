import { test, expect } from '../../fixtures/test-base'
import { generateDocument, generateProject, generateWorkspace } from '../../helpers/factory'

test.describe('Document: CRUD, Star, Views, and Public Sharing', () => {
  test('should perform full document lifecycle: create, list, read, update, thumbnails, duplicate, move, star, view, and public link', async ({
    userRequest,
    userContext,
    request,
    playwright,
  }) => {
    // 1. Setup Workspace & 2 Projects
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

    const projRes1 = await wsRequest.post('/api/v1/projects', { data: generateProject('Project A') })
    const projectA = (await projRes1.json()).data
    const projRes2 = await wsRequest.post('/api/v1/projects', { data: generateProject('Project B') })
    const projectB = (await projRes2.json()).data

    // 2. Create Document in Project A
    const docData = generateDocument('System Design')
    const createDocRes = await wsRequest.post('/api/v1/documents', {
      data: {
        ...docData,
        projectId: projectA.id,
      },
    })
    expect(createDocRes.status()).toBe(201)
    const doc = (await createDocRes.json()).data
    expect(doc.id).toBeDefined()
    expect(doc.title).toBe(docData.title)
    expect(doc.type).toBe('markdown')
    expect(doc.authorId).toBe(userContext.user.id)
    expect(doc.author.email).toBe(userContext.user.email)
    const docId = doc.id

    // 3. List Documents
    const listRes = await wsRequest.get('/api/v1/documents')
    expect(listRes.status()).toBe(200)
    const docs = (await listRes.json()).data
    expect(Array.isArray(docs)).toBe(true)
    const found = docs.find((d: { id: string }) => d.id === docId)
    expect(found).toBeDefined()

    // Test Search filter
    const searchRes = await wsRequest.get(`/api/v1/documents?search=${encodeURIComponent('System Design')}`)
    const searchDocs = (await searchRes.json()).data
    expect(searchDocs.some((d: { id: string }) => d.id === docId)).toBe(true)

    // 4. Get Document by ID
    const getRes = await wsRequest.get(`/api/v1/documents/${docId}`)
    expect(getRes.status()).toBe(200)
    const detail = (await getRes.json()).data
    expect(detail.id).toBe(docId)
    expect(detail.title).toBe(docData.title)

    // 5. Update Document
    const updateRes = await wsRequest.put(`/api/v1/documents/${docId}`, {
      data: {
        title: 'System Design v2',
        content: 'Updated system architecture content',
        tags: ['architecture', 'production'],
        isDraft: true,
      },
    })
    expect(updateRes.status()).toBe(200)
    const updated = (await updateRes.json()).data
    expect(updated.title).toBe('System Design v2')
    expect(updated.isDraft).toBe(true)
    expect(updated.tags).toContain('production')

    // 6. Update Thumbnails
    const thumbRes = await wsRequest.put(`/api/v1/documents/${docId}/thumbnails`, {
      data: {
        thumbnail: '<svg id="thumb-light"></svg>',
        thumbnailDark: '<svg id="thumb-dark"></svg>',
        thumbnailPreview: '<svg id="preview-light"></svg>',
        thumbnailPreviewDark: '<svg id="preview-dark"></svg>',
      },
    })
    expect(thumbRes.status()).toBe(200)

    // 7. Record View
    const viewRes = await wsRequest.post(`/api/v1/documents/${docId}/view`)
    expect(viewRes.status()).toBe(200)

    // 8. Toggle Star
    const starRes1 = await wsRequest.post(`/api/v1/documents/${docId}/star`)
    expect(starRes1.status()).toBe(200)
    expect((await starRes1.json()).data.isStarred).toBe(true)

    // Filter by starred
    const starredListRes = await wsRequest.get('/api/v1/documents?filterTab=starred')
    const starredDocs = (await starredListRes.json()).data
    expect(starredDocs.some((d: { id: string }) => d.id === docId)).toBe(true)

    // 9. Duplicate Document
    const dupRes = await wsRequest.post(`/api/v1/documents/${docId}/duplicate`)
    expect(dupRes.status()).toBe(201)
    const cloned = (await dupRes.json()).data
    expect(cloned.id).not.toBe(docId)
    expect(cloned.title).toBe('Copy of System Design v2')

    // 10. Move Document to Project B
    const moveRes = await wsRequest.put(`/api/v1/documents/${docId}/move`, {
      data: { targetProjectId: projectB.id },
    })
    expect(moveRes.status()).toBe(200)

    const checkMovedRes = await wsRequest.get(`/api/v1/documents/${docId}`)
    expect((await checkMovedRes.json()).data.projectId).toBe(projectB.id)

    // 11. Public Link Sharing
    const shareRes = await wsRequest.post(`/api/v1/documents/${docId}/share-token`)
    expect(shareRes.status()).toBe(200)
    const shareToken = (await shareRes.json()).data.shareToken
    expect(shareToken).toBeDefined()
    expect(shareToken.length).toBeGreaterThan(10)

    // Unauthenticated public access via shareToken
    const publicRes = await request.get(`/api/v1/public/documents/${shareToken}`)
    expect(publicRes.status()).toBe(200)
    const publicDoc = (await publicRes.json()).data
    expect(publicDoc.id).toBe(docId)
    expect(publicDoc.title).toBe('System Design v2')

    await wsRequest.dispose()
  })

  test('should return 404 for non-existent document ID', async ({ userRequest, playwright, userContext }) => {
    const wsRes = await userRequest.post('/api/v1/workspaces', { data: generateWorkspace() })
    const workspace = (await wsRes.json()).data

    const wsRequest = await playwright.request.newContext({
      baseURL: process.env.API_URL || 'http://localhost:8080',
      extraHTTPHeaders: {
        Authorization: `Bearer ${userContext.token}`,
        'X-Workspace-Id': workspace.id,
      },
    })

    const res = await wsRequest.get('/api/v1/documents/00000000-0000-0000-0000-000000000099')
    expect(res.status()).toBe(404)
    await wsRequest.dispose()
  })
})
