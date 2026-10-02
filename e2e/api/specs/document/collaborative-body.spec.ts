import { randomUUID } from 'node:crypto'
import { test, expect } from '../../fixtures/test-base'
import { generateWorkspace } from '../../helpers/factory'

test('DeleteNode commits the body epoch and returns its durable receipt on retry', async ({
  userRequest,
  userContext,
  playwright,
}) => {
  const workspaceResponse = await userRequest.post('/api/v1/workspaces', {
    data: generateWorkspace(),
  })
  expect(workspaceResponse.status()).toBe(201)
  const workspace = (await workspaceResponse.json()).data
  const workspaceRequest = await playwright.request.newContext({
    baseURL: process.env.API_URL || 'http://localhost:8080',
    extraHTTPHeaders: {
      Authorization: `Bearer ${userContext.token}`,
      'X-Workspace-Id': workspace.id,
      'Content-Type': 'application/json',
    },
  })

  try {
    const documentID = randomUUID()
    const rootNodeID = randomUUID()
    const deletedNodeID = randomUUID()
    const createResponse = await workspaceRequest.post('/api/v1/documents', {
      headers: { 'Idempotency-Key': randomUUID() },
      data: {
        title: 'DeleteNode receipt test',
        type: 'markdown',
        initialBody: {
          documentID,
          bodySchemaVersion: 1,
          rootNodeID,
          nodes: [
            {
              nodeID: rootNodeID,
              parentID: null,
              siblingOrder: 0,
              type: 'document',
              content: '',
              attributes: {},
            },
            {
              nodeID: deletedNodeID,
              parentID: rootNodeID,
              siblingOrder: 1,
              type: 'paragraph',
              content: 'remove me',
              attributes: {},
            },
          ],
        },
      },
    })
    expect(createResponse.status()).toBe(201)

    const command = {
      commandID: randomUUID(),
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      nodeID: deletedNodeID,
    }
    const deleteResponse = await workspaceRequest.post(
      `/api/v1/documents/${documentID}/body/delete`,
      { data: command },
    )
    expect(deleteResponse.status()).toBe(200)
    const receipt = (await deleteResponse.json()).data
    expect(receipt).toMatchObject({
      documentID,
      commandID: command.commandID,
      nodeID: deletedNodeID,
      bodyEpoch: 2,
      bodyVersion: 2,
      changed: true,
    })

    const retryResponse = await workspaceRequest.post(
      `/api/v1/documents/${documentID}/body/delete`,
      { data: command },
    )
    expect(retryResponse.status()).toBe(200)
    expect((await retryResponse.json()).data).toEqual(receipt)

    const reusedIDResponse = await workspaceRequest.post(
      `/api/v1/documents/${documentID}/body/delete`,
      { data: { ...command, nodeID: rootNodeID } },
    )
    expect(reusedIDResponse.status()).toBe(409)

    const bodyResponse = await workspaceRequest.get(
      `/api/v1/documents/${documentID}/body`,
    )
    expect(bodyResponse.status()).toBe(200)
    expect((await bodyResponse.json()).data).toMatchObject({
      bodyEpoch: 2,
      bodyVersion: 2,
      rootNodeID,
      nodes: [expect.objectContaining({ nodeID: rootNodeID })],
    })
  } finally {
    await workspaceRequest.dispose()
  }
})
