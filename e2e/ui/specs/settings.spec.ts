import { test, expect, setAuthenticatedState } from '../fixtures/test-base'

test.describe('Settings & Error Flows', () => {
  test.beforeEach(async ({ page }) => {
    await setAuthenticatedState(page)
  })

  test('navigates across settings tabs', async ({ settingsPage }) => {
    await settingsPage.goto()
    await settingsPage.expectSectionTitle(/workspace profile/i)

    await settingsPage.selectTab('Billing')
    await settingsPage.expectSectionTitle(/current subscription/i)

    await settingsPage.selectTab('Members')
    await settingsPage.expectSectionTitle(/workspace members/i)

    await settingsPage.selectTab('Notifications')
    await settingsPage.expectSectionTitle(/workspace notifications/i)
  })

  test('displays 404 page for unknown routes', async ({ page, dashboardPage }) => {
    await dashboardPage.goto()
    await page.goto('/random-unknown-url-404')
    await expect(page.getByText(/404/i).first()).toBeVisible()
    await expect(page.getByText(/page not found/i).first()).toBeVisible()
  })
})
