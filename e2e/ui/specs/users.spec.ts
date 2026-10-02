import { test, expect, setAuthenticatedState } from '../fixtures/test-base'

test.describe('Users Management Flows', () => {
  test.beforeEach(async ({ page }) => {
    await setAuthenticatedState(page)
  })

  test('renders user list table', async ({ page, usersPage }) => {
    await usersPage.goto()
    await expect(page.getByRole('heading', { name: 'User List' })).toBeVisible()
    await usersPage.expectRowCountAtLeast(1)
  })

  test('filters users with search input', async ({ page, usersPage }) => {
    await usersPage.goto()
    await usersPage.searchUser('admin')
    await expect(page.locator('tbody tr').first()).toBeVisible()
  })

  test('opens invite user dialog', async ({ page, usersPage }) => {
    await usersPage.goto()
    await usersPage.openInviteDialog()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('heading', { name: /invite user/i })).toBeVisible()
  })
})
