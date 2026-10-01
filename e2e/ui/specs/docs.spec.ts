import { test, expect, setAuthenticatedState } from '../fixtures/test-base'

test.describe('Document Editor Flows', () => {
  test.beforeEach(async ({ page }) => {
    await setAuthenticatedState(page)
  })

  test('loads markdown document with correct title and header controls', async ({ docEditorPage }) => {
    await docEditorPage.goto('doc-1')
    await expect(docEditorPage.titleElement).toHaveText('Order Processing FSD')
    await expect(docEditorPage.commentsButton).toBeVisible()
    await expect(docEditorPage.shareButton).toBeVisible()
    await expect(docEditorPage.exportButton).toBeVisible()
  })

  test('loads DBML document and renders database diagram canvas', async ({ docEditorPage }) => {
    await docEditorPage.goto('doc-2')
    await expect(docEditorPage.titleElement).toHaveText('E-Commerce Database Schema')
    await docEditorPage.expectCanvasRendered()
  })

  test('loads Mermaid document and renders diagram flowchart', async ({ docEditorPage }) => {
    await docEditorPage.goto('doc-3')
    await expect(docEditorPage.titleElement).toHaveText('Checkout & Payment Flow')
    await docEditorPage.expectCanvasRendered()
  })

  test('allows editing document title in header', async ({ docEditorPage }) => {
    await docEditorPage.goto('doc-1')
    await docEditorPage.editTitle('Updated Order Processing FSD')
    await expect(docEditorPage.titleElement).toHaveText('Updated Order Processing FSD')
  })

  test('toggles comments sidebar panel', async ({ page, docEditorPage }) => {
    await docEditorPage.goto('doc-1')
    await docEditorPage.toggleComments()
    const commentsPanel = page.getByRole('heading', { name: /comments/i }).or(page.locator('aside, [data-sidebar="comments"]')).first()
    await expect(commentsPanel).toBeVisible()
  })

  test('displays not found fallback for non-existent document ID', async ({ page, docEditorPage }) => {
    await docEditorPage.goto('non-existent-doc-id-999')
    await expect(page.getByText('Document Not Found')).toBeVisible()
    const backBtn = page.getByRole('link', { name: /back to dashboard/i })
    await expect(backBtn).toBeVisible()
    await backBtn.click()
    await page.waitForURL('/')
    await expect(page).toHaveURL('/')
  })
})
