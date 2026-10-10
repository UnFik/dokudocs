import { synchronizeSession, useAuthStore } from '@/stores/auth-store'

export class ApiError extends Error {
  constructor(
    public status: number,
    public title: string,
    public data?: unknown
  ) {
    super(title || `HTTP Error ${status}`)
    this.name = 'ApiError'
  }
}

const emailNotVerifiedHandlers = new Set<() => void>()
/** Runs the handler when the server refuses a request because the email is not verified. */
export function onEmailNotVerified(handler: () => void) {
  emailNotVerifiedHandlers.add(handler)
  return () => void emailNotVerifiedHandlers.delete(handler)
}

type ApiOptions = RequestInit & { authenticated?: boolean }

export async function apiFetch<T = unknown>(
  endpoint: string,
  options: ApiOptions = {}
): Promise<T> {
  const url = new URL(endpoint, window.location.origin)
  if (
    url.origin !== window.location.origin ||
    !url.pathname.startsWith('/api/')
  ) {
    throw new Error('API requests must use the same-origin /api/ path')
  }
  synchronizeSession()
  const { accessToken, revision } = useAuthStore.getState().auth
  const { authenticated = true, ...request } = options
  const headers = new Headers(request.headers)
  if (!headers.has('Content-Type') && !(request.body instanceof FormData))
    headers.set('Content-Type', 'application/json')
  headers.delete('Authorization')
  if (authenticated && accessToken)
    headers.set('Authorization', `Bearer ${accessToken}`)
  const response = await fetch(url.href, {
    ...request,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  })
  let data: unknown = null
  if (response.headers.get('content-type')?.includes('application/json')) {
    try {
      data = await response.json()
    } catch {
      /* Invalid bodies are rejected by the response schema. */
    }
  }
  synchronizeSession()
  if (
    authenticated &&
    accessToken &&
    useAuthStore.getState().auth.revision !== revision
  ) {
    throw new DOMException('Session changed', 'AbortError')
  }
  if (!response.ok) {
    if (response.status === 401 && authenticated && accessToken)
      useAuthStore.getState().auth.reset()
    const title =
      data &&
      typeof data === 'object' &&
      'title' in data &&
      typeof data.title === 'string'
        ? data.title
        : response.statusText || 'Request failed'
    if (
      response.status === 403 &&
      data &&
      typeof data === 'object' &&
      'code' in data &&
      data.code === 'email_not_verified'
    )
      emailNotVerifiedHandlers.forEach((handler) => handler())
    throw new ApiError(response.status, title, data)
  }
  return (
    data && typeof data === 'object' && 'data' in data ? data.data : data
  ) as T
}

/** A stored file read with the session; images and video cannot send the token themselves. */
export async function apiBlob(endpoint: string): Promise<Blob> {
  const url = new URL(endpoint, window.location.origin)
  if (
    url.origin !== window.location.origin ||
    !url.pathname.startsWith('/api/')
  ) {
    throw new Error('API requests must use the same-origin /api/ path')
  }
  synchronizeSession()
  const { accessToken } = useAuthStore.getState().auth
  const headers = new Headers()
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  const response = await fetch(url.href, {
    headers,
    credentials: 'same-origin',
  })
  if (!response.ok)
    throw new ApiError(response.status, response.statusText || 'Request failed')
  return response.blob()
}
