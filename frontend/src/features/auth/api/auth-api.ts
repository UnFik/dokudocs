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
export async function startGoogleApi(redirect: string) {
  return z.object({ authorizationUrl: z.url() }).parse(
    await apiFetch('/api/v1/auth/google/start', {
      method: 'POST',
      authenticated: false,
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
