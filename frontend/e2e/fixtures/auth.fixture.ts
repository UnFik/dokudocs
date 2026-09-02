import { type Page } from '@playwright/test'

export const MOCK_USER = {
  accountNo: 'ACC-001',
  email: 'fikri@dokudocs.app',
  role: ['superadmin'],
  exp: 1893456000,
}

export const MOCK_TOKEN = 'mock-valid-jwt-token'

export async function setupAuthMockRoutes(page: Page) {
  await page.route('**/api/v1/auth/login', async (route) => {
    const postData = route.request().postDataJSON()
    if (postData?.email === 'fikri@dokudocs.app' && postData?.password === 'password123') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            accessToken: MOCK_TOKEN,
            user: MOCK_USER,
          },
        }),
      })
    } else {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'Invalid email or password',
        }),
      })
    }
  })

  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: MOCK_USER,
      }),
    })
  })
}

export async function setAuthenticatedState(page: Page) {
  await setupAuthMockRoutes(page)
  await page.context().addCookies([
    {
      name: 'thisisjustarandomstring',
      value: JSON.stringify(MOCK_TOKEN),
      url: 'http://127.0.0.1:4173',
    },
  ])
}
