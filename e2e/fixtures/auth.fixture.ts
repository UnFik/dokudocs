import { test as base, request as playwrightRequest, type APIRequestContext } from '@playwright/test'
import { generateUser } from '../helpers/factory'

export interface AuthUserContext {
  token: string
  user: {
    id: string
    accountNo: string
    email: string
    role: string[]
  }
}

export type AuthFixtures = {
  adminToken: string
  adminRequest: APIRequestContext
  userContext: AuthUserContext
  userRequest: APIRequestContext
}

export const test = base.extend<AuthFixtures>({
  adminToken: async ({ request }, use) => {
    const res = await request.post('/api/v1/auth/login', {
      data: {
        email: 'admin@example.com',
        password: 'password123',
      },
    })
    if (!res.ok()) {
      throw new Error(`Failed to login admin: ${res.status()} ${await res.text()}`)
    }
    const json = await res.json()
    const token = json.data?.accessToken || json.accessToken
    await use(token)
  },

  adminRequest: async ({ adminToken, playwright }, use) => {
    const ctx = await playwright.request.newContext({
      baseURL: process.env.API_URL || 'http://localhost:8080',
      extraHTTPHeaders: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    })
    await use(ctx)
    await ctx.dispose()
  },

  userContext: async ({ request }, use) => {
    const newUser = generateUser()
    const regRes = await request.post('/api/v1/auth/register', {
      data: newUser,
    })
    if (!regRes.ok()) {
      throw new Error(`Failed to register test user: ${regRes.status()} ${await regRes.text()}`)
    }
    const regJson = await regRes.json()
    const payload = regJson.data || regJson
    await use({
      token: payload.accessToken,
      user: payload.user,
    })
  },

  userRequest: async ({ userContext, playwright }, use) => {
    const ctx = await playwright.request.newContext({
      baseURL: process.env.API_URL || 'http://localhost:8080',
      extraHTTPHeaders: {
        Authorization: `Bearer ${userContext.token}`,
        'Content-Type': 'application/json',
      },
    })
    await use(ctx)
    await ctx.dispose()
  },
})

export { expect } from '@playwright/test'
