import { z } from 'zod'

const uuidSchema = z
  .string()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    'Invalid UUID'
  )

export const authUserSchema = z.object({
  id: uuidSchema,
  accountNo: z.string().min(1),
  email: z.email(),
  role: z.array(z.string()),
  exp: z.number().int().positive(),
})
export const authResponseSchema = z.object({
  accessToken: z.string().min(1),
  user: authUserSchema,
})
export type AuthUser = z.infer<typeof authUserSchema>
export type AuthResponse = z.infer<typeof authResponseSchema>

export const loginSchema = z.object({
  email: z.email('Please enter a valid email.'),
  password: z.string().min(1, 'Please enter your password.'),
})
export const registerSchema = loginSchema.extend({
  fullName: z
    .string()
    .trim()
    .refine(
      (name) => [...name].length >= 2 && [...name].length <= 100,
      'Name must be between 2 and 100 characters.'
    ),
  password: z
    .string()
    .refine(
      (password) => [...password].length >= 15,
      'Password must be at least 15 characters long.'
    )
    .refine(
      (password) => new TextEncoder().encode(password).length <= 72,
      'Password must be at most 72 UTF-8 bytes.'
    ),
})

const claimsSchema = z.object({
  sub: uuidSchema,
  exp: z.number().int().positive(),
})
export function readTokenClaims(token: string) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3 || parts.some((part) => !part)) return null
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const bytes = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0))
    const claims = claimsSchema.parse(
      JSON.parse(new TextDecoder().decode(bytes))
    )
    return claims.exp * 1000 > Date.now() ? claims : null
  } catch {
    return null
  }
}
