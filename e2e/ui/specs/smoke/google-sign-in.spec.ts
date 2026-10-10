import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { FakeGoogle } from '../../helpers/fake-google'

// Signing in with Google, in a real browser against the real backend and database.
// Google itself is the stand-in in helpers/fake-google.ts.

test.describe.configure({ mode: 'serial' })

const google = new FakeGoogle()
test.beforeAll(() => google.start())
test.afterAll(() => google.stop())

const bindingCookie = 'dokudocs_google_binding'

test('@live @smoke: a new Google user lands signed in, with nothing secret left in the address', async ({ page }) => {
  const email = `google-${randomUUID()}@example.test`
  google.next = { sub: `sub-${randomUUID()}`, email, name: 'Browser Google' }

  const addresses: string[] = []
  page.on('framenavigated', (frame) => frame === page.mainFrame() && addresses.push(frame.url()))

  await page.goto('/sign-in')
  await page.getByRole('button', { name: 'Continue with Google' }).click()
  await page.waitForURL((url) => url.pathname === '/dashboard')

  // The one-time code was in the address for the callback only; the page took it out.
  const dashboard = new URL(page.url())
  expect(dashboard.search).toBe('')
  expect(page.url()).not.toMatch(/code=|token=|state=/)
  // The binding cookie is gone once the sign-in finished.
  const cookies = await page.context().cookies()
  expect(cookies.find((c) => c.name === bindingCookie)).toBeUndefined()
  expect(cookies.find((c) => c.name === 'thisisjustarandomstring')).toBeDefined()

  // The profile is Google's, and the account page lists Google as connected.
  await page.goto('/settings/account')
  await expect(page.getByLabel('Email Address')).toHaveValue(email)
  await expect(page.getByLabel('Full Name')).toHaveValue('Browser Google')
  await expect(page.getByText(email, { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Disconnect Google' })).toBeVisible()
  // Google only: the page offers a password, and unlinking is refused until there is one.
  await expect(page.getByLabel('New password')).toBeVisible()
  await page.getByRole('button', { name: 'Disconnect Google' }).click()
  await expect(page.getByRole('alert')).toContainText('Set a password')
})

test('@live @smoke: signing in again with the same Google account is the same user', async ({ page, request }) => {
  const email = `google-again-${randomUUID()}@example.test`
  const identity = { sub: `sub-${randomUUID()}`, email, name: 'Come Back' }
  const idOf = async () => {
    const token = (await page.context().cookies()).find((c) => c.name === 'thisisjustarandomstring')!.value
    const me = await request.get(`${process.env.API_URL ?? 'http://localhost:8080'}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    return ((await me.json()) as { data: { id: string } }).data.id
  }

  google.next = identity
  await page.goto('/sign-in')
  await page.getByRole('button', { name: 'Continue with Google' }).click()
  await page.waitForURL((url) => url.pathname === '/dashboard')
  const first = await idOf()

  await page.context().clearCookies()
  await page.goto('/sign-in')
  google.next = { ...identity, email: `moved-${email}` }
  await page.getByRole('button', { name: 'Continue with Google' }).click()
  await page.waitForURL((url) => url.pathname === '/dashboard')
  expect(await idOf()).toBe(first)
})

test('@live @smoke: cancelling at Google says so and signs nobody in', async ({ page }) => {
  google.next = 'deny'
  await page.goto('/sign-in')
  await page.getByRole('button', { name: 'Continue with Google' }).click()
  await expect(page.getByRole('alert')).toContainText('cancelled')
  const cookies = await page.context().cookies()
  expect(cookies.find((c) => c.name === 'thisisjustarandomstring')).toBeUndefined()
  expect(cookies.find((c) => c.name === bindingCookie)).toBeUndefined()
  await page.getByRole('link', { name: 'Back to sign in' }).click()
  await expect(page).toHaveURL(/\/sign-in/)
})
