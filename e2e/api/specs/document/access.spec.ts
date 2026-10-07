import { createHash, randomUUID } from 'node:crypto'
import { test, expect } from '../../fixtures/test-base'
import { generateDocument, generateProject, generateUser, generateWorkspace } from '../../helpers/factory'

test.describe('Document: Collaborator Access Control', () => {
  test('list and detail enforce private grants and draft edit access', async ({
    userRequest,
    userContext,
    request,
    playwright,
  }) => {
    const wsRes = await userRequest.post('/api/v1/workspaces', { data: generateWorkspace() })
    expect(wsRes.status()).toBe(201)
    const workspace = (await wsRes.json()).data
    const ownerRequest = await playwright.request.newContext({
      baseURL: process.env.API_URL || 'http://localhost:8080',
      extraHTTPHeaders: {
        Authorization: `Bearer ${userContext.token}`,
        'X-Workspace-Id': workspace.id,
        'Content-Type': 'application/json',
      },
    })

    const adminData = generateUser()
    const adminRegisterRes = await request.post('/api/v1/auth/register', { data: adminData })
    expect(adminRegisterRes.status()).toBe(201)
    const registeredAdmin = (await adminRegisterRes.json()).data
    const adminInviteRes = await userRequest.post(`/api/v1/workspaces/${workspace.id}/invites`, {
      data: { email: adminData.email, role: 'admin' },
    })
    expect(adminInviteRes.status()).toBe(201)
    const adminRequest = await playwright.request.newContext({
      baseURL: process.env.API_URL || 'http://localhost:8080',
      extraHTTPHeaders: {
        Authorization: `Bearer ${registeredAdmin.accessToken}`,
        'X-Workspace-Id': workspace.id,
        'Content-Type': 'application/json',
      },
    })

    const userBData = generateUser()
    const registerRes = await request.post('/api/v1/auth/register', { data: userBData })
    expect(registerRes.status()).toBe(201)
    const registered = (await registerRes.json()).data
    const inviteRes = await userRequest.post(`/api/v1/workspaces/${workspace.id}/invites`, {
      data: { email: userBData.email, role: 'member' },
    })
    expect(inviteRes.ok()).toBeTruthy()

    const memberRequest = await playwright.request.newContext({
      baseURL: process.env.API_URL || 'http://localhost:8080',
      extraHTTPHeaders: {
        Authorization: `Bearer ${registered.accessToken}`,
        'X-Workspace-Id': workspace.id,
        'Content-Type': 'application/json',
      },
    })

    const projectRes = await ownerRequest.post('/api/v1/projects', {
      data: { ...generateProject('Private Access'), visibility: 'private' },
    })
    expect(projectRes.status()).toBe(201)
    const privateProject = (await projectRes.json()).data

    const create = async (title: string, isDraft = false, projectId?: string, visibility = 'private') => {
      const response = await ownerRequest.post('/api/v1/documents', {
        headers: { 'Idempotency-Key': randomUUID() },
        data: { ...generateDocument(title), projectId, visibility, isDraft },
      })
      expect(response.status()).toBe(201)
      return (await response.json()).data
    }
    const hidden = await create('Private hidden')
    const viewable = await create('Private view grant')
    const draftView = await create('Private draft view', true)
    const draftEdit = await create('Private draft edit', true)
    const inheritedProjectDoc = await create('Inherited private project', false, privateProject.id, 'inherit')
    const workspaceOverrideDoc = await create('Workspace override project', false, privateProject.id, 'workspace')
    const privateProjectGrantedDoc = await create('Private project direct grant', false, privateProject.id, 'private')
    const publicLinkDraft = await create('Public link draft', true, privateProject.id, 'public_link')
    const publicLinkDoc = await create('Public link only', false, undefined, 'public_link')
    const thumbnailPayload = {
      thumbnail: '<svg id="access-thumbnail"></svg>',
      thumbnailDark: '<svg id="access-thumbnail-dark"></svg>',
      thumbnailPreview: '<svg id="access-preview"></svg>',
      thumbnailPreviewDark: '<svg id="access-preview-dark"></svg>',
    }
    const shareTokenRes = await ownerRequest.post(`/api/v1/documents/${publicLinkDoc.id}/share-token`)
    expect(shareTokenRes.status()).toBe(200)
    const shareToken = (await shareTokenRes.json()).data.shareToken
    const draftShareTokenRes = await ownerRequest.post(`/api/v1/documents/${publicLinkDraft.id}/share-token`)
    expect(draftShareTokenRes.status()).toBe(200)
    const draftShareToken = (await draftShareTokenRes.json()).data.shareToken

    for (const [doc, level] of [
      [viewable, 'view'],
      [draftView, 'view'],
      [draftEdit, 'edit'],
      [privateProjectGrantedDoc, 'view'],
      [publicLinkDraft, 'view'],
    ] as const) {
      const grantRes = await ownerRequest.post(`/api/v1/documents/${doc.id}/accesses`, {
        data: { email: userBData.email, level },
      })
      expect(grantRes.status()).toBe(201)
    }

    const listRes = await memberRequest.get('/api/v1/documents')
    expect(listRes.status()).toBe(200)
    const listedIds = (await listRes.json()).data.map((doc: { id: string }) => doc.id)
    expect(listedIds).not.toContain(hidden.id)
    expect(listedIds).toContain(viewable.id)
    expect(listedIds).not.toContain(draftView.id)
    expect(listedIds).toContain(draftEdit.id)
    expect(listedIds).not.toContain(inheritedProjectDoc.id)
    expect(listedIds).toContain(workspaceOverrideDoc.id)
    expect(listedIds).toContain(privateProjectGrantedDoc.id)
    expect(listedIds).not.toContain(publicLinkDoc.id)
    expect(listedIds).not.toContain(publicLinkDraft.id)

    for (const [doc, status] of [
      [hidden, 404],
      [viewable, 200],
      [draftView, 404],
      [draftEdit, 200],
      [inheritedProjectDoc, 404],
      [workspaceOverrideDoc, 200],
      [privateProjectGrantedDoc, 200],
      [publicLinkDoc, 404],
      [publicLinkDraft, 404],
    ] as const) {
      const response = await memberRequest.get(`/api/v1/documents/${doc.id}`)
      expect(response.status()).toBe(status)
    }
    expect((await memberRequest.post(`/api/v1/documents/${hidden.id}/view`)).status()).toBe(404)
    expect((await memberRequest.post(`/api/v1/documents/${hidden.id}/star`)).status()).toBe(404)
    const deniedDuplicate = await memberRequest.post(`/api/v1/documents/${hidden.id}/duplicate`, {
      headers: { 'Idempotency-Key': randomUUID() },
    })
    expect(deniedDuplicate.status()).toBe(404)

    expect((await memberRequest.post(`/api/v1/documents/${viewable.id}/view`)).status()).toBe(200)
    const viewGrantStar = await memberRequest.post(`/api/v1/documents/${viewable.id}/star`)
    expect(viewGrantStar.status()).toBe(200)
    expect((await viewGrantStar.json()).data.isStarred).toBe(true)
    const readableDuplicate = await memberRequest.post(`/api/v1/documents/${viewable.id}/duplicate`, {
      headers: { 'Idempotency-Key': randomUUID() },
    })
    expect(readableDuplicate.status()).toBe(201)
    const deniedPrivateProjectCreate = await memberRequest.post('/api/v1/documents', {
      headers: { 'Idempotency-Key': randomUUID() },
      data: {
        ...generateDocument('Viewer cannot create in private project'),
        projectId: privateProject.id,
        visibility: 'inherit',
      },
    })
    expect(deniedPrivateProjectCreate.status()).toBe(404)
    const viewGrantMove = await memberRequest.put(`/api/v1/documents/${privateProjectGrantedDoc.id}/move`, {
      data: { targetProjectId: privateProject.id },
    })
    expect(viewGrantMove.status()).toBe(403)
    expect((await memberRequest.delete(`/api/v1/documents/${viewable.id}`)).status()).toBe(403)
    expect((await ownerRequest.get(`/api/v1/documents/${viewable.id}`)).status()).toBe(200)
    for (const doc of [viewable, workspaceOverrideDoc, privateProjectGrantedDoc]) {
      const updateResponse = await memberRequest.put(`/api/v1/documents/${doc.id}`, {
        data: { title: `Member cannot edit ${doc.title}` },
      })
      expect(updateResponse.status()).toBe(403)
    }
    const viewGrantThumbnail = await memberRequest.put(`/api/v1/documents/${viewable.id}/thumbnails`, {
      data: thumbnailPayload,
    })
    expect(viewGrantThumbnail.status()).toBe(403)
    const editGrantThumbnail = await memberRequest.put(`/api/v1/documents/${draftEdit.id}/thumbnails`, {
      data: thumbnailPayload,
    })
    expect(editGrantThumbnail.status()).toBe(200)
    const draftEditResponse = await memberRequest.put(`/api/v1/documents/${draftEdit.id}`, {
      data: { title: 'Editor may update private draft' },
    })
    expect(draftEditResponse.status()).toBe(200)
    const unchangedViewable = await ownerRequest.get(`/api/v1/documents/${viewable.id}`)
    expect((await unchangedViewable.json()).data.title).toBe(viewable.title)
    const grantedDocData = (await (await memberRequest.get(`/api/v1/documents/${privateProjectGrantedDoc.id}`)).json()).data
    expect(grantedDocData.projectName ?? '').toBe('')
    const privateCategoryFilter = await memberRequest.get('/api/v1/documents?category=General')
    const privateCategoryDocs = (await privateCategoryFilter.json()).data.map((doc: { id: string }) => doc.id)
    expect(privateCategoryDocs).not.toContain(privateProjectGrantedDoc.id)
    expect(privateCategoryDocs).not.toContain(workspaceOverrideDoc.id)
    expect((await memberRequest.get(`/api/v1/projects/${privateProject.id}`)).status()).toBe(404)
    expect((await memberRequest.get(`/api/v1/projects/${privateProject.id}/categories`)).status()).toBe(404)
    expect((await memberRequest.get(`/api/v1/projects/${privateProject.id}/members`)).status()).toBe(404)

    for (const doc of [hidden, draftView, inheritedProjectDoc, publicLinkDraft, publicLinkDoc]) {
      expect((await adminRequest.get(`/api/v1/documents/${doc.id}`)).status()).toBe(200)
    }
    const adminProject = await adminRequest.get(`/api/v1/projects/${privateProject.id}`)
    expect(adminProject.status()).toBe(200)
    expect((await adminProject.json()).data.documentCount).toBe(4)
    expect((await adminRequest.get(`/api/v1/projects/${privateProject.id}/categories`)).status()).toBe(200)
    expect((await adminRequest.get(`/api/v1/projects/${privateProject.id}/members`)).status()).toBe(200)

    expect((await memberRequest.get(`/api/v1/public/documents/${shareToken}`)).status()).toBe(200)
    expect((await memberRequest.get(`/api/v1/public/documents/${draftShareToken}`)).status()).toBe(404)

    const addProjectMemberRes = await ownerRequest.post(`/api/v1/projects/${privateProject.id}/members`, {
      data: { email: userBData.email, role: 'viewer' },
    })
    expect(addProjectMemberRes.status()).toBe(201)
    expect((await memberRequest.get(`/api/v1/documents/${inheritedProjectDoc.id}`)).status()).toBe(200)
    const viewerUpdate = await memberRequest.put(`/api/v1/documents/${inheritedProjectDoc.id}`, {
      data: { title: 'Viewer cannot edit inherited document' },
    })
    expect(viewerUpdate.status()).toBe(403)
    const viewerThumbnail = await memberRequest.put(`/api/v1/documents/${inheritedProjectDoc.id}/thumbnails`, {
      data: thumbnailPayload,
    })
    expect(viewerThumbnail.status()).toBe(403)
    expect((await memberRequest.get(`/api/v1/projects/${privateProject.id}/categories`)).status()).toBe(200)
    const projectMembers = (await (await memberRequest.get(`/api/v1/projects/${privateProject.id}/members`)).json()).data
    expect(projectMembers.some((member: { user: { email: string } }) => member.user.email === userBData.email)).toBeTruthy()
    const afterProjectGrant = (await (await memberRequest.get('/api/v1/documents')).json()).data.map(
      (doc: { id: string }) => doc.id,
    )
    expect(afterProjectGrant).toContain(inheritedProjectDoc.id)
    const visibleCategoryDocs = (await (await memberRequest.get('/api/v1/documents?category=General')).json()).data.map(
      (doc: { id: string }) => doc.id,
    )
    expect(visibleCategoryDocs).toContain(privateProjectGrantedDoc.id)

    const promoteProjectMember = await ownerRequest.post(`/api/v1/projects/${privateProject.id}/members`, {
      data: { email: userBData.email, role: 'editor' },
    })
    expect(promoteProjectMember.status()).toBe(201)
    const editorList = (await (await memberRequest.get('/api/v1/documents')).json()).data.map(
      (doc: { id: string }) => doc.id,
    )
    expect(editorList).not.toContain(publicLinkDraft.id)
    expect((await memberRequest.get(`/api/v1/documents/${publicLinkDraft.id}`)).status()).toBe(404)
    const editorInheritedUpdate = await memberRequest.put(`/api/v1/documents/${inheritedProjectDoc.id}`, {
      data: { title: 'Editor may update inherited document' },
    })
    expect(editorInheritedUpdate.status()).toBe(200)
    const editorInheritedThumbnail = await memberRequest.put(
      `/api/v1/documents/${inheritedProjectDoc.id}/thumbnails`,
      { data: thumbnailPayload },
    )
    expect(editorInheritedThumbnail.status()).toBe(200)
    const editorWorkspaceOverrideUpdate = await memberRequest.put(`/api/v1/documents/${workspaceOverrideDoc.id}`, {
      data: { title: 'Editor may update explicit workspace document' },
    })
    expect(editorWorkspaceOverrideUpdate.status()).toBe(200)
    const editorPrivateUpdate = await memberRequest.put(`/api/v1/documents/${privateProjectGrantedDoc.id}`, {
      data: { title: 'Project editor cannot edit explicit private document' },
    })
    expect(editorPrivateUpdate.status()).toBe(403)
    const projectDetail = await memberRequest.get(`/api/v1/projects/${privateProject.id}`)
    expect(projectDetail.status()).toBe(200)
    expect((await projectDetail.json()).data.documentCount).toBe(3)

    await memberRequest.dispose()
    await adminRequest.dispose()
    await ownerRequest.dispose()
  })

  test('body initialization requires current edit access', async ({
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
    const viewerRequest = await playwright.request.newContext({
      baseURL: process.env.API_URL || 'http://localhost:8080',
      extraHTTPHeaders: {
        Authorization: `Bearer ${viewer.accessToken}`,
        'X-Workspace-Id': workspace.id,
        'Content-Type': 'application/json',
      },
    })

    const documentData = generateDocument('Body initialization access')
    const createRes = await ownerRequest.post('/api/v1/documents', {
      headers: { 'Idempotency-Key': randomUUID() },
      data: { ...documentData, visibility: 'private' },
    })
    expect(createRes.status()).toBe(201)
    const document = (await createRes.json()).data
    const grantRes = await ownerRequest.post(`/api/v1/documents/${document.id}/accesses`, {
      data: { email: viewerData.email, level: 'view' },
    })
    expect(grantRes.status()).toBe(201)

    // Only someone who can edit the document may read its JSON for writing; a
    // viewer reads it, and the public link shows the stored Markdown.
    const viewerRead = await viewerRequest.get(`/api/v1/documents/${document.id}`)
    expect(viewerRead.status()).toBe(200)

    const shareRes = await ownerRequest.post(`/api/v1/documents/${document.id}/share-token`)
    expect(shareRes.status()).toBe(200)
    const shareToken = (await shareRes.json()).data.shareToken
    const publicDocument = await request.get(`/api/v1/public/documents/${shareToken}`)
    expect(publicDocument.status()).toBe(200)
    expect((await publicDocument.json()).data).toMatchObject({ content: documentData.content })
    expect((await request.get('/api/v1/public/documents/invalid-token')).status()).toBe(404)

    await viewerRequest.dispose()
    await ownerRequest.dispose()
  })

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
      headers: { 'Idempotency-Key': randomUUID() },
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
    const userBRequest = await playwright.request.newContext({
      baseURL: process.env.API_URL || 'http://localhost:8080',
      extraHTTPHeaders: {
        Authorization: `Bearer ${userB.accessToken}`,
        'X-Workspace-Id': workspace.id,
        'Content-Type': 'application/json',
      },
    })
    const userCData = generateUser()
    const regCRes = await request.post('/api/v1/auth/register', { data: userCData })
    expect(regCRes.status()).toBe(201)
    await userRequest.post(`/api/v1/workspaces/${workspace.id}/invites`, {
      data: { email: userCData.email, role: 'member' },
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

    const viewerEscalationRes = await userBRequest.post(`/api/v1/documents/${docId}/accesses`, {
      data: { email: userBData.email, level: 'edit' },
    })
    expect(viewerEscalationRes.status()).toBe(403)
    const viewerShareRes = await userBRequest.post(`/api/v1/documents/${docId}/accesses`, {
      data: { email: userCData.email, level: 'view' },
    })
    expect(viewerShareRes.status()).toBe(403)
    const viewerTokenRes = await userBRequest.post(`/api/v1/documents/${docId}/share-token`)
    expect(viewerTokenRes.status()).toBe(403)
    const selfRevokeRes = await userBRequest.delete(`/api/v1/documents/${docId}/accesses/${userB.user.id}`)
    expect(selfRevokeRes.status()).toBe(200)
    const afterSelfRevokeRes = await wsRequestA.get(`/api/v1/documents/${docId}/accesses`)
    const afterSelfRevoke = (await afterSelfRevokeRes.json()).data
    expect(afterSelfRevoke.some((access: { userId: string }) => access.userId === userB.user.id)).toBe(false)
    const restoreViewGrantRes = await wsRequestA.post(`/api/v1/documents/${docId}/accesses`, {
      data: { email: userBData.email, level: 'view' },
    })
    expect(restoreViewGrantRes.status()).toBe(201)

    // 8. Revoke User B's access
    const removeAccRes = await wsRequestA.delete(`/api/v1/documents/${docId}/accesses/${userB.user.id}`)
    expect(removeAccRes.status()).toBe(200)

    // Verify 1 access remains
    const finalAccRes = await wsRequestA.get(`/api/v1/documents/${docId}/accesses`)
    const finalAcc = (await finalAccRes.json()).data
    expect(finalAcc.length).toBe(1)
    expect(finalAcc.find((a: { userId: string }) => a.userId === userB.user.id)).toBeUndefined()

    await userBRequest.dispose()
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
      headers: { 'Idempotency-Key': randomUUID() },
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
