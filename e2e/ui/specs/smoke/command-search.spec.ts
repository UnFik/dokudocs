import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { createdDocumentID, documentPayload } from '../../helpers/markdown-document'

// Needs the backend `make test-e2e-*` starts. The document body is found through
// the index worker, which polls every 10 seconds, so the first search waits for it.
test.describe.configure({ mode: 'serial' })

const apiURL = process.env.API_URL ?? 'http://localhost:8080'
const searchBox = (page: Page) => page.getByPlaceholder(/Search documents, projects, commands/)
let title: string
let codeword: string
let documentID: string
let headers: Record<string, string>

async function signIn(page: Page) {
  await page.goto('/sign-in')
  await page.locator('input[name="email"]').fill('admin@example.com')
  await page.locator('input[name="password"]').fill('password123')
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL((url) => url.pathname === '/dashboard')
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage()
  await signIn(page)
  const cookie = (await page.context().cookies()).find((c) => c.name === 'thisisjustarandomstring')
  expect(cookie).toBeDefined()
  const authorization = `Bearer ${cookie!.value}`
  const workspaces = await page.request.get(`${apiURL}/api/v1/workspaces`, { headers: { Authorization: authorization } })
  const workspaceID = (await workspaces.json()).data[0].id as string
  headers = { Authorization: authorization, 'X-Workspace-Id': workspaceID }

  const suffix = `${Date.now()}`
  title = `Launch checklist ${suffix}`
  codeword = `quincunx${suffix}`
  const rootNodeID = randomUUID()
  const paragraphNodeID = randomUUID()
  const created = await page.request.post(`${apiURL}/api/v1/documents`, {
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
    data: {
      title,
      type: 'markdown',
      visibility: 'workspace',
      isDraft: false,
      ...documentPayload([
        { nodeID: rootNodeID, parentID: null, siblingOrder: 0, type: 'document', content: '', attributes: {} },
        { nodeID: paragraphNodeID, parentID: rootNodeID, siblingOrder: 0, type: 'paragraph', content: '', attributes: {} },
        { nodeID: randomUUID(), parentID: paragraphNodeID, siblingOrder: 0, type: 'run', content: `Rotate the ${codeword} key before the freeze.`, attributes: {} },
      ]),
    },
  })
  expect(created.status()).toBe(201)
  documentID = await createdDocumentID(created)
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${apiURL}/api/v1/documents/search?q=${codeword}`, { headers })
        return response.ok() ? ((await response.json()).data as unknown[]).length : -1
      },
      { timeout: 60_000, intervals: [3_000] },
    )
    .toBeGreaterThan(0)
  await page.close()
})

test.afterAll(async ({ request }) => {
  if (documentID) await request.delete(`${apiURL}/api/v1/documents/${documentID}`, { headers })
})

test('@smoke: Ctrl+K from the dashboard finds a document by a word in its body and opens it', async ({ page }) => {
  await signIn(page)
  await page.keyboard.press('Control+k')
  await expect(searchBox(page)).toBeVisible()
  await searchBox(page).fill(codeword)

  const row = page.getByRole('option', { name: new RegExp(title) })
  await expect(row).toBeVisible()
  await expect(row.locator('strong', { hasText: codeword })).toBeVisible()

  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/docs/${documentID}`))
  await expect(searchBox(page)).toBeHidden()
})

test('@smoke: in the editor Ctrl+K searches from a caret and links a selection', async ({ page }) => {
  await signIn(page)
  await page.goto(`/docs/${documentID}`)
  const editor = page.locator('[contenteditable="true"]').first()
  await expect(editor).toContainText(codeword)

  await editor.click()
  await page.keyboard.press('Control+k')
  await expect(searchBox(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(searchBox(page)).toBeHidden()
  await expect(editor).toBeFocused()

  // The format toolbar, and with it the link field, belongs to a text selection;
  // select-all does not raise it.
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await expect(page.getByRole('toolbar', { name: 'Format selection' })).toBeVisible()
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('textbox', { name: 'Link address' })).toBeVisible()
  await expect(searchBox(page)).toBeHidden()
})

test('@smoke: Ctrl+K on the sign-in page is left to the browser', async ({ page }) => {
  await page.goto('/sign-in')
  await page.keyboard.press('Control+k')
  await expect(searchBox(page)).toHaveCount(0)
})
