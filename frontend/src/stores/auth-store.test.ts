import { clearCookies } from '@/test-utils/cookies'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from './auth-store'

const user = {
  id: 'b4d13df7-76a2-4da5-8817-91d40f832abd',
  accountNo: 'ACC-1',
  email: 'user@example.com',
  role: ['member'],
  exp: Math.floor(Date.now() / 1000) + 3600,
}
const token = `${btoa(JSON.stringify({ alg: 'HS256' }))}.${btoa(JSON.stringify({ ...user, sub: user.id }))}.signature`

describe('CurrentUser session', () => {
  beforeEach(() => {
    useAuthStore.getState().auth.reset()
    clearCookies()
  })

  it('publishes User and AccessToken together and preserves neither on logout', () => {
    useAuthStore.getState().auth.setSession({ user, accessToken: token })
    expect(useAuthStore.getState().auth.user).toEqual(user)
    expect(useAuthStore.getState().auth.accessToken).toBe(token)
    expect(document.cookie).toContain(token)
    useAuthStore.getState().auth.reset()
    expect(useAuthStore.getState().auth.user).toBeNull()
    expect(useAuthStore.getState().auth.accessToken).toBe('')
    expect(document.cookie).not.toContain(token)
  })
})
