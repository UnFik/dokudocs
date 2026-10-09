import { test, expect } from '@playwright/test'

test.describe('Backend and Frontend Live Integration @live', () => {
  test('authenticates with live backend and loads authenticated user profile', async ({ page }) => {
    await page.goto('/sign-in')

    await page.locator('input[name="email"]').fill('admin@example.com')
    await page.locator('input[name="password"]').fill('password123')
    await page.getByRole('button', { name: /sign in/i }).click()

    await page.waitForURL((url) => url.pathname === '/dashboard')
    await expect(page.getByRole('heading', { name: /dokudocs workspace/i })).toBeVisible()

    const userProfileName = page.locator('[data-slot="sidebar-container"] [data-slot="sidebar-footer"], [data-sidebar="footer"]').first()
    await expect(userProfileName).toContainText('System Administrator')
  })

  test('handles invalid credentials via live backend rejection', async ({ page }) => {
    await page.goto('/sign-in')

    await page.locator('input[name="email"]').fill('admin@example.com')
    await page.locator('input[name="password"]').fill('incorrectpassword123')
    await page.getByRole('button', { name: /sign in/i }).click()

    const toast = page.locator('[data-sonner-toast]').first()
    await expect(toast).toBeVisible()
    await expect(toast).toContainText(/invalid email or password/i)
  })

  test('registers a new user against live backend and accesses dashboard', async ({ page }) => {
    const randomSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const testEmail = `integ_${randomSuffix}@dokudocs.test`
    const testPassword = 'Password123456789!'

    await page.goto('/sign-up')

    await page.locator('input[name="fullName"]').fill('Integration Test User')
    await page.locator('input[name="email"]').fill(testEmail)
    await page.locator('input[name="password"]').fill(testPassword)
    await page.locator('input[name="confirmPassword"]').fill(testPassword)
    await page.getByRole('button', { name: /create account/i }).click()

    await page.waitForURL((url) => url.pathname === '/dashboard')
    await expect(page.getByRole('heading', { name: /dokudocs workspace/i })).toBeVisible()

    const footer = page.locator('[data-slot="sidebar-container"] [data-slot="sidebar-footer"], [data-sidebar="footer"]').first()
    await expect(footer).toContainText('Integration Test User')
  })

  test('persists session across page reload using live backend auth/me verification', async ({ page }) => {
    await page.goto('/sign-in')

    await page.locator('input[name="email"]').fill('admin@example.com')
    await page.locator('input[name="password"]').fill('password123')
    await page.getByRole('button', { name: /sign in/i }).click()

    await page.waitForURL((url) => url.pathname === '/dashboard')
    await expect(page.getByRole('heading', { name: /dokudocs workspace/i })).toBeVisible()

    await page.reload()
    await expect(page.getByRole('heading', { name: /dokudocs workspace/i })).toBeVisible()
    await expect(page).toHaveURL('/dashboard')
  })
})
