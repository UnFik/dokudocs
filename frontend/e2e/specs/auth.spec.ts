import { test, expect } from '../fixtures/test-base'
import { setupAuthMockRoutes } from '../fixtures/auth.fixture'

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthMockRoutes(page)
  })

  test('successful login with valid credentials redirects to dashboard', async ({ page, loginPage }) => {
    await loginPage.goto()
    await loginPage.login('fikri@dokudocs.app', 'password123')
    await page.waitForURL((url) => url.pathname === '/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('failed login with invalid credentials shows error feedback', async ({ loginPage }) => {
    await loginPage.goto()
    await loginPage.login('invalid@dokudocs.app', 'wrongpassword')
    await loginPage.expectToast(/error/i)
  })

  test('form displays validation errors on invalid email and short password', async ({ loginPage }) => {
    await loginPage.goto()
    await loginPage.login('not-an-email', '123')
    await loginPage.expectValidationError(/email/i)
    await loginPage.expectValidationError(/password/i)
  })
})
