import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { ApiError } from '@/lib/api-client'
import { safeRedirect } from '@/lib/auth-guard'
import {
  loginApi,
  registerApi,
  type AuthResponse,
  type LoginPayload,
  type RegisterPayload,
} from '../api/auth-api'

interface UseLoginOptions {
  redirectTo?: string
  onSuccess?: (data: AuthResponse) => void
  onError?: (error: ApiError) => void
}

export function useLoginMutation(options?: UseLoginOptions) {
  const navigate = useNavigate()
  const { auth } = useAuthStore()

  return useMutation({
    mutationFn: async (payload: LoginPayload) => {
      const revision = useAuthStore.getState().auth.revision
      const data = await loginApi(payload)
      if (useAuthStore.getState().auth.revision !== revision)
        throw new Error('Session changed. Please try again.')
      auth.setSession(data)
      return data
    },
    onSuccess: (data) => {
      toast.success(`Welcome back, ${data.user.email}!`)
      const targetPath = safeRedirect(options?.redirectTo)
      navigate({ to: targetPath, replace: true })
      options?.onSuccess?.(data)
    },
    onError: (error: unknown) => {
      const apiErr =
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              error instanceof Error ? error.message : 'Failed to sign in'
            )
      toast.error(apiErr.title)
      options?.onError?.(apiErr)
    },
  })
}

interface UseRegisterOptions {
  onSuccess?: (data: AuthResponse) => void
  onError?: (error: ApiError) => void
}

export function useRegisterMutation(options?: UseRegisterOptions) {
  const navigate = useNavigate()
  const { auth } = useAuthStore()

  return useMutation({
    mutationFn: async (payload: RegisterPayload) => {
      const revision = useAuthStore.getState().auth.revision
      const data = await registerApi(payload)
      if (useAuthStore.getState().auth.revision !== revision)
        throw new Error('Session changed. Please try again.')
      auth.setSession(data)
      return data
    },
    onSuccess: (data) => {
      toast.success(
        `Account created successfully! Welcome, ${data.user.email}!`
      )
      navigate({ to: '/dashboard', replace: true })
      options?.onSuccess?.(data)
    },
    onError: (error: unknown) => {
      const apiErr =
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              error instanceof Error
                ? error.message
                : 'Failed to create account'
            )
      toast.error(apiErr.title)
      options?.onError?.(apiErr)
    },
  })
}
