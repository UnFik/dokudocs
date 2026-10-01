import { test, expect, setAuthenticatedState } from '../fixtures/test-base'

test.describe('Dashboard Flows', () => {
  test.beforeEach(async ({ page }) => {
    await setAuthenticatedState(page)
  })

  test('renders dashboard workspace with sections and filter tabs', async ({ page, dashboardPage }) => {
    await dashboardPage.goto()
    await expect(page.getByRole('heading', { name: /dokudocs workspace/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /recent documents/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /projects/i })).toBeVisible()
  })

  test('switches filter tabs properly', async ({ page, dashboardPage }) => {
    await dashboardPage.goto()
    await expect(page.getByRole('button', { name: /all/i }).first()).toBeVisible()
    await dashboardPage.selectFilterTab('Starred')
    await expect(page.getByRole('button', { name: /starred/i }).first()).toBeVisible()

    await dashboardPage.selectFilterTab('Created by me')
    await expect(page.getByRole('button', { name: /created by me/i }).first()).toBeVisible()
  })

  test('opens create document modal from dropdown', async ({ page, dashboardPage }) => {
    await dashboardPage.goto()
    await dashboardPage.openNewDocModal('markdown')
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('navigates to document editor when clicking a recent card', async ({ page, dashboardPage }) => {
    await dashboardPage.goto()
    await dashboardPage.openDocByTitle('Order Processing FSD')
    await page.waitForURL(/\/docs\/doc-1/)
    await expect(page).toHaveURL(/\/docs\/doc-1/)
  })
})
