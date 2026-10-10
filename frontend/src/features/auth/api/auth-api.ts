import { z } from 'zod'
import { apiFetch } from '@/lib/api-client'
import {
  authResponseSchema,
  authUserSchema,
  type loginSchema,
  type registerSchema,
} from './auth-schema'

export type { AuthResponse, AuthUser } from './auth-schema'
export type LoginPayload = z.infer<typeof loginSchema>
export type RegisterPayload = z.infer<typeof registerSchema>

export async function loginApi(payload: LoginPayload) {
  return authResponseSchema.parse(
    await apiFetch('/api/v1/auth/login', {
      method: 'POST',
      authenticated: false,
      body: JSON.stringify(payload),
    })
  )
}
export async function registerApi(payload: RegisterPayload) {
  return authResponseSchema.parse(
    await apiFetch('/api/v1/auth/register', {
      method: 'POST',
      authenticated: false,
      body: JSON.stringify(payload),
    })
  )
}
export async function currentUserApi(signal?: AbortSignal) {
  return authUserSchema.parse(await apiFetch('/api/v1/auth/me', { signal }))
}
/** With `authenticated`, the User is already signed in and links the Google account instead of signing in. */
export async function startGoogleApi(redirect: string, authenticated = false) {
  return z.object({ authorizationUrl: z.url() }).parse(
    await apiFetch('/api/v1/auth/google/start', {
      method: 'POST',
      authenticated,
      body: JSON.stringify({ redirect }),
    })
  )
}
export async function exchangeGoogleApi(code: string) {
  return authResponseSchema.extend({ redirect: z.string() }).parse(
    await apiFetch('/api/v1/auth/google/exchange', {
      method: 'POST',
      authenticated: false,
      body: JSON.stringify({ code }),
    })
  )
}
export async function verifyEmailApi(token: string) {
  return authResponseSchema.parse(
    await apiFetch('/api/v1/auth/email/verify', {
      method: 'POST',
      authenticated: false,
      body: JSON.stringify({ token }),
    })
  )
}
export async function resendVerificationApi() {
  await apiFetch('/api/v1/auth/email/resend', { method: 'POST' })
}

const signInMethodsSchema = z.object({
  hasPassword: z.boolean(),
  identities: z.array(
    z.object({
      provider: z.string(),
      email: z.string(),
      linkedAt: z.string(),
    })
  ),
})
export async function signInMethodsApi(signal?: AbortSignal) {
  return signInMethodsSchema.parse(
    await apiFetch('/api/v1/auth/identities', { signal })
  )
}
export async function unlinkIdentityApi(provider: string) {
  await apiFetch(`/api/v1/auth/identities/${encodeURIComponent(provider)}`, {
    method: 'DELETE',
  })
}
/** Mails the signed-in User a one-time link to set or change the password. */
export async function sendPasswordLinkApi() {
  await apiFetch('/api/v1/auth/password/link', { method: 'POST' })
}
/** Says whether the link is still usable by this User, without using it up. */
export async function checkPasswordLinkApi(
  token: string,
  signal?: AbortSignal
) {
  await apiFetch('/api/v1/auth/password/check', {
    method: 'POST',
    body: JSON.stringify({ token }),
    signal,
  })
}
export async function setPasswordApi(token: string, password: string) {
  await apiFetch('/api/v1/auth/password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  })
}
