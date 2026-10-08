import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { createdDocumentID, documentPayload } from '../../helpers/markdown-document'

// Needs a backend started with OPENAI_API_KEY (embedding and answer models), a
// disposable PostgreSQL, and the seeded admin user. Without a key the API answers
// 503, so the spec is skipped unless RAG_LIVE=1.
test('@live @rag: /assistant answers from an indexed Markdown block with a clickable citation', async ({
  page,
}) => {
  test.skip(!process.env.RAG_LIVE, 'set RAG_LIVE=1 with a backend that has OPENAI_API_KEY')
  test.setTimeout(240_000)

  const suffix = `${Date.now()}`
  const codeword = `heliotrope${suffix}`
  const sentence = `The recovery codeword for the ${codeword} vault is cobalt.`
  const documentID = randomUUID()
  const rootNodeID = randomUUID()
  const paragraphNodeID = randomUUID()
  const runNodeID = randomUUID()

  await page.goto('/sign-in')
  await page.locator('input[name="email"]').fill('admin@example.com')
  await page.locator('input[name="password"]').fill('password123')
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL((url) => url.pathname !== '/sign-in')

  await page.getByRole('button', { name: /workspace/i }).first().click()
  await page.getByRole('menuitem', { name: 'Create Workspace' }).click()
  await page.getByLabel('Workspace Name').fill(`RAG e2e ${suffix}`)
  const workspaceCreated = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/workspaces',
  )
  await page.getByRole('button', { name: 'Create Workspace' }).click()
  const workspaceResponse = await workspaceCreated
  expect(workspaceResponse.ok()).toBe(true)
  const workspaceID = (await workspaceResponse.json()).data.id as string

  const accessCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === 'thisisjustarandomstring',
  )
  expect(accessCookie).toBeDefined()
  const apiURL = process.env.API_URL ?? 'http://localhost:8080'
  const headers = {
    Authorization: `Bearer ${accessCookie!.value}`,
    'X-Workspace-Id': workspaceID,
  }

  const created = await page.request.post(`${apiURL}/api/v1/documents`, {
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
    data: {
      title: `Vault runbook ${suffix}`,
      type: 'markdown',
      visibility: 'workspace',
      isDraft: false,
      ...documentPayload([
          { nodeID: rootNodeID, parentID: null, siblingOrder: 0, type: 'document', content: '', attributes: {} },
          { nodeID: paragraphNodeID, parentID: rootNodeID, siblingOrder: 0, type: 'paragraph', content: '', attributes: {} },
          { nodeID: runNodeID, parentID: paragraphNodeID, siblingOrder: 0, type: 'run', content: sentence, attributes: {} },
        ]),
    },
  })
  expect(created.status()).toBe(201)
  documentID = await createdDocumentID(created);

  // The index worker polls every 10 seconds; wait until the API reports a
  // cited answer so the browser steps below do not race the indexer.
  const probe = (await (await page.request.post(`${apiURL}/api/v1/rag/conversations`, { headers, data: {} })).json()).data.id as string
  await expect
    .poll(
      async () => {
        const response = await page.request.post(
          `${apiURL}/api/v1/rag/conversations/${probe}/messages`,
          { headers, data: { question: `What is the recovery codeword for the ${codeword} vault?`, language: 'en' } },
        )
        if (!response.ok()) return -1
        return ((await response.json()).data.citations as unknown[]).length
      },
      { timeout: 120_000, intervals: [5_000] },
    )
    .toBeGreaterThan(0)

  await page.goto('/assistant')
  await page.getByRole('button', { name: 'New chat' }).click()
  await page
    .getByRole('textbox', { name: 'Ask a question' })
    .fill(`What is the recovery codeword for the ${codeword} vault?`)
  const asked = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/v1\/rag\/conversations\/[^/]+\/messages$/.test(new URL(response.url()).pathname),
  )
  await page.getByRole('button', { name: 'Send' }).click()
  const askResponse = await asked
  expect(askResponse.status()).toBe(200)
  const answer = (await askResponse.json()).data
  expect(answer.citations[0].documentId).toBe(documentID)
  expect(answer.citations[0].nodeId).toBe(paragraphNodeID)

  await expect(page.getByText(answer.text, { exact: false }).first()).toBeVisible()
  await expect(page.locator('blockquote').filter({ hasText: codeword })).toBeVisible()
  const link = page.getByRole('link', { name: 'Open block' })
  await expect(link).toHaveAttribute('href', new RegExp(`/docs/${documentID}.*nodeId=${paragraphNodeID}`))
  await link.click()
  await page.waitForURL((url) => url.pathname === `/docs/${documentID}`)
  await expect(page.getByText(sentence)).toBeVisible()
})
