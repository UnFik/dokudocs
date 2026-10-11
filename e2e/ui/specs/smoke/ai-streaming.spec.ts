import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { createdDocumentID, documentPayload } from '../../helpers/markdown-document'
import { FakeAIProvider } from '../../helpers/fake-ai-provider'

// Needs the backend `make test-e2e-*` starts (AI_ALLOW_PRIVATE_HOSTS=true, so the
// provider can be a local fake). The fake holds its answer half way, so each step
// looks at the screen while the provider is still writing.
test.describe.configure({ mode: 'serial' })

const apiURL = process.env.API_URL ?? 'http://localhost:8080'
let provider: FakeAIProvider
let conversationQuestion: string
let toRemove: { workspaceID: string; authorization: string } | undefined

test.beforeAll(async () => {
  provider = new FakeAIProvider()
  await provider.start()
})
test.afterAll(async () => {
  await provider.stop()
  // The suite shares one admin account, and other specs look for the workspace
  // switcher by the word "workspace", which a named workspace no longer shows.
  if (toRemove) {
    await fetch(`${apiURL}/api/v1/workspaces/${toRemove.workspaceID}`, {
      method: 'DELETE',
      headers: { Authorization: toRemove.authorization },
    })
  }
})

async function signIn(page: Page) {
  await page.goto('/sign-in')
  await page.locator('input[name="email"]').fill('admin@example.com')
  await page.locator('input[name="password"]').fill('password123')
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL((url) => url.pathname === '/dashboard')
}

async function token(page: Page) {
  const cookie = (await page.context().cookies()).find((c) => c.name === 'thisisjustarandomstring')
  expect(cookie).toBeDefined()
  return cookie!.value
}

async function setUp(page: Page) {
  const suffix = `${Date.now()}`
  const codeword = `heliotrope${suffix}`
  conversationQuestion = `What is the recovery codeword for the ${codeword} vault?`
  await signIn(page)
  const authorization = `Bearer ${await token(page)}`
  // Created in the UI, so it is the workspace the assistant page asks in.
  await page.getByRole('button', { name: /workspace/i }).first().click()
  await page.getByRole('menuitem', { name: 'Create Workspace' }).click()
  await page.getByLabel('Workspace Name').fill(`AI streaming ${suffix}`)
  const workspaceCreated = page.waitForResponse(
    (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/workspaces',
  )
  await page.getByRole('button', { name: 'Create Workspace' }).click()
  const workspaceResponse = await workspaceCreated
  expect(workspaceResponse.ok()).toBe(true)
  const workspaceID = (await workspaceResponse.json()).data.id as string
  toRemove = { workspaceID, authorization }
  const headers = { Authorization: authorization, 'X-Workspace-Id': workspaceID }

  // The answer provider is the local fake; saving it is itself a job that must pass.
  const saved = await page.request.post(`${apiURL}/api/v1/platform/ai/answer/runs`, {
    headers: { Authorization: authorization, 'Idempotency-Key': randomUUID() },
    data: { operation: 'save', baseURL: provider.url, protocol: 'openai_chat_completions', model: 'fake', apiKey: 'sk-fake-e2e' },
  })
  expect(saved.status()).toBe(202)
  const runID = (await saved.json()).data.id as string
  await expect
    .poll(async () => (await (await page.request.get(`${apiURL}/api/v1/ai/runs/${runID}`, { headers })).json()).data.status, { timeout: 15_000 })
    .toBe('completed')

  const rootNodeID = randomUUID()
  const paragraphNodeID = randomUUID()
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
        { nodeID: randomUUID(), parentID: paragraphNodeID, siblingOrder: 0, type: 'run', content: `The recovery codeword for the ${codeword} vault is cobalt.`, attributes: {} },
      ]),
    },
  })
  expect(created.status()).toBe(201)
  await createdDocumentID(created)

  // The index worker polls every 10 seconds; ask until an answer has a citation.
  const probe = (await (await page.request.post(`${apiURL}/api/v1/rag/conversations`, { headers, data: {} })).json()).data.id as string
  await expect
    .poll(
      async () => {
        const response = await page.request.post(`${apiURL}/api/v1/rag/conversations/${probe}/messages`, {
          headers,
          data: { question: conversationQuestion, language: 'en' },
        })
        return response.ok() ? ((await response.json()).data.citations as unknown[]).length : -1
      },
      { timeout: 60_000, intervals: [3_000] },
    )
    .toBeGreaterThan(0)
  // Only the chat the page opens should exist: with another one listed, the page
  // switches chats while the first question is typed and drops the text.
  const removed = await page.request.delete(`${apiURL}/api/v1/rag/conversations/${probe}`, { headers })
  expect(removed.status()).toBe(204)
}

async function ask(page: Page, newChat = true) {
  await page.goto('/assistant')
  if (newChat) await page.getByRole('button', { name: 'New chat' }).first().click()
  await page.getByRole('textbox', { name: 'Ask a question' }).fill(conversationQuestion)
  await page.getByRole('button', { name: 'Send' }).click()
}

test('@smoke: the answer shows while the provider is still writing, and joins the chat once', async ({ page }) => {
  test.setTimeout(120_000)
  await setUp(page)
  provider.hold()
  const completedBefore = provider.completed
  await ask(page)

  // The first part is on screen as a draft; the provider has not finished.
  await expect(page.getByText('The recovery codeword is', { exact: false })).toBeVisible()
  await expect(page.getByText('dokudocs ai · draft')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible()
  expect(provider.completed).toBe(completedBefore)
  await expect(page.getByText('cobalt.', { exact: false })).toHaveCount(0)

  // Reloading the page picks the same run up; it does not start a second one.
  const starts: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/runs$/.test(new URL(request.url()).pathname)) starts.push(request.url())
  })
  await page.reload()
  await expect(page.getByText('The recovery codeword is', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible()

  provider.release()
  await expect(page.getByText('The recovery codeword is cobalt.', { exact: true })).toBeVisible()
  await expect(page.getByText('dokudocs ai · draft')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Open block' })).toBeVisible()
  await expect(page.getByText('The recovery codeword is cobalt.', { exact: true })).toHaveCount(1)
  expect(starts).toHaveLength(0)
})

test('@smoke: Stop ends the answer, keeps the draft labelled, and lets the next question start', async ({ page }) => {
  test.setTimeout(120_000)
  // The first test left the workspace, its document and its chat; ask in that chat.
  await signIn(page)
  provider.hold()
  const abandonedBefore = provider.abandoned
  await ask(page, false)
  await expect(page.getByText('The recovery codeword is', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByText(/This draft was not saved to the chat/)).toBeVisible()
  await expect.poll(() => provider.abandoned).toBeGreaterThan(abandonedBefore)
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()
  provider.release()
})
