import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { createdDocumentID, documentPayload } from '../../helpers/markdown-document'

test('@live: public share route renders the canonical Markdown AST read-only', async ({
  page,
}) => {
  const suffix = `${Date.now()}`
  const title = `Shared Markdown ${suffix}`
  let documentID = randomUUID()
  const rootNodeID = randomUUID()
  const paragraphNodeID = randomUUID()
  const runNodeID = randomUUID()

  await page.goto('/sign-in')
  await page.locator('input[name="email"]').fill('admin@example.com')
  await page.locator('input[name="password"]').fill('password123')
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL((url) => url.pathname === '/')

  await page.getByRole('button', { name: /workspace/i }).first().click()
  await page.getByRole('menuitem', { name: 'Create Workspace' }).click()
  await page.getByLabel('Workspace Name').fill(`Public share ${suffix}`)
  const workspaceCreated = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      response.request().method() === 'POST' &&
      url.pathname === '/api/v1/workspaces'
    )
  })
  await page.getByRole('button', { name: 'Create Workspace' }).click()
  const workspaceResponse = await workspaceCreated
  expect(workspaceResponse.ok()).toBe(true)
  const workspaceID = (await workspaceResponse.json()).data.id as string
  await expect(
    page.getByRole('button', { name: new RegExp(`Public share ${suffix}`) })
  ).toBeVisible()

  const accessCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === 'thisisjustarandomstring',
  )
  expect(accessCookie).toBeDefined()
  const apiURL = process.env.API_URL ?? 'http://localhost:8080'
  const authHeaders = {
    Authorization: `Bearer ${accessCookie!.value}`,
  }
  const workspaceHeaders = {
    ...authHeaders,
    'X-Workspace-Id': workspaceID,
  }
  const createResponse = await page.request.post(
    `${apiURL}/api/v1/documents`,
    {
      headers: {
        ...workspaceHeaders,
        'Idempotency-Key': randomUUID(),
      },
      data: {
        title,
        type: 'markdown',
        visibility: 'workspace',
        isDraft: false,
        ...documentPayload([
            {
              nodeID: rootNodeID,
              parentID: null,
              siblingOrder: 0,
              type: 'document',
              content: '',
              attributes: {},
            },
            {
              nodeID: paragraphNodeID,
              parentID: rootNodeID,
              siblingOrder: 0,
              type: 'paragraph',
              content: '',
              attributes: {},
            },
            {
              nodeID: runNodeID,
              parentID: paragraphNodeID,
              siblingOrder: 0,
              type: 'run',
              content: 'Rendered from the stored Markdown.',
              attributes: {},
            },
          ]),
      },
    },
  )
  expect(createResponse.status()).toBe(201)
  documentID = await createdDocumentID(createResponse);

  await page.goto(`/docs/${documentID}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
  await page.getByRole('button', { name: 'Share' }).click()
  await expect(page.getByRole('dialog', { name: 'Share document' })).toBeVisible()
  const shareResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      response.request().method() === 'POST' &&
      url.pathname === `/api/v1/documents/${documentID}/share-token`
    )
  })
  await page.getByRole('button', { name: 'Create public link' }).click()
  const shareResponse = await shareResponsePromise
  expect(shareResponse.status()).toBe(200)
  const shareToken = (await shareResponse.json()).data.shareToken as string
  const shareURL = await page.getByRole('textbox', { name: 'Public link' }).inputValue()
  expect(shareURL).toContain(`/public/documents/${shareToken}`)
  await page.keyboard.press('Escape')
  await page.reload()
  await page.getByRole('button', { name: 'Share' }).click()
  const repeatedShareResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      response.request().method() === 'POST' &&
      url.pathname === `/api/v1/documents/${documentID}/share-token`
    )
  })
  await page.getByRole('button', { name: 'Create public link' }).click()
  const repeatedShareResponse = await repeatedShareResponsePromise
  expect((await repeatedShareResponse.json()).data.shareToken).toBe(shareToken)

  await page.goto(shareURL)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
  await expect(page.getByRole('article', { name: 'Document contents' })).toContainText(
    'Rendered from the stored Markdown.',
  )
  await expect(page.locator('.ProseMirror')).toHaveCount(0)

  await page.goto('/')
  await expect(page.getByText('Rendered from the stored Markdown.')).toBeVisible()
})
