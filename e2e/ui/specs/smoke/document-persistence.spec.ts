import { test, expect } from '../../fixtures/test-base'

test('live smoke @smoke: creates a document and reads it from the backend after reload', async ({
  page,
}) => {
  const suffix = `${Date.now()}`
  const workspaceName = `Smoke workspace ${suffix}`
  const documentTitle = `Smoke schema ${suffix}`

  await page.goto('/sign-in')
  await page.locator('input[name="email"]').fill('admin@example.com')
  await page.locator('input[name="password"]').fill('password123')
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL((url) => url.pathname === '/dashboard')

  await page.getByRole('button', { name: /workspace/i }).first().click()
  await page.getByRole('menuitem', { name: 'Create Workspace' }).click()
  await page.getByLabel('Workspace Name').fill(workspaceName)
  const workspaceResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/workspaces'
  )
  await page.getByRole('button', { name: 'Create Workspace' }).click()
  const workspaceID = (
    (await (await workspaceResponse).json()) as { data: { id: string } }
  ).data.id
  await expect(page.getByRole('button', { name: new RegExp(workspaceName) })).toBeVisible()

  await page.getByRole('button', { name: /new/i }).first().click()
  await page.getByRole('menuitem', { name: /db diagram/i }).click()
  await page.getByLabel(/document title/i).fill(documentTitle)
  await page.getByRole('button', { name: 'Database Diagram' }).click()
  await page.getByRole('button', { name: 'Create Document' }).click()
  await page.waitForURL(/\/docs\/[0-9a-f-]{36}$/i)

  // Read it back from the server, for the workspace this test made.
  const token = (await page.context().cookies()).find(
    (cookie) => cookie.name === 'thisisjustarandomstring'
  )!.value
  const apiURL = process.env.API_URL ?? 'http://localhost:8080'
  const response = await page.request.get(`${apiURL}/api/v1/documents`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Workspace-Id': workspaceID },
  })
  expect(response.ok()).toBe(true)
  const { data } = (await response.json()) as {
    data: Array<{ title: string; content: string }>
  }
  expect(data.find((document) => document.title === documentTitle)).toMatchObject({
    title: documentTitle,
    content: expect.stringContaining('Table users'),
  })
})
