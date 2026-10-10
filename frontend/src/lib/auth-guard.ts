import { redirect } from '@tanstack/react-router'
import { synchronizeSession, useAuthStore } from '@/stores/auth-store'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { currentUserApi } from '@/features/auth/api/auth-api'
import { readTokenClaims } from '@/features/auth/api/auth-schema'
import { hasLocalCopy } from '@/features/docs/lib/collab-session'
import { ApiError } from './api-client'
import { switchLocalUser } from './local-user-data'
import { queryClient } from './query-client'

export function safeRedirect(value?: string) {
  if (
    !value ||
    !value.startsWith('/') ||
    /[\\%\s]/.test(value) ||
    value.startsWith('//')
  )
    return '/dashboard'
  const url = new URL(value, window.location.origin)
  if (
    !/^\/(?:$|dashboard\/?$|account\/?$|projects(?:\/[^/]+)?\/?$|docs\/[^/]+\/?$|drafts\/?$|trash\/?$|users\/?$|settings(?:\/(?:account(?:\/set-password)?|appearance|display|notifications))?\/?$|help-center\/?$)/.test(
      url.pathname
    )
  )
    return '/dashboard'
  return `${url.pathname}${url.search}${url.hash}`
}

export async function restoreSession() {
  synchronizeSession()
  const auth = useAuthStore.getState().auth
  if (!auth.accessToken) return null
  if (!readTokenClaims(auth.accessToken)) {
    auth.reset()
    return null
  }
  if (auth.status === 'authenticated') {
    switchLocalUser(auth.user.id)
    return auth.user
  }
  try {
    const user = await queryClient.fetchQuery({
      queryKey: ['current-user', auth.revision],
      queryFn: ({ signal }) => currentUserApi(signal),
      staleTime: Infinity,
      retry: false,
    })
    synchronizeSession()
    if (useAuthStore.getState().auth.revision !== auth.revision)
      return restoreSession()
    if (!useAuthStore.getState().auth.restoreUser(user, auth.revision)) {
      useAuthStore.getState().auth.reset()
      return null
    }
    return user
  } catch (error) {
    if (useAuthStore.getState().auth.revision !== auth.revision)
      return restoreSession()
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

export async function requireAuth({
  location,
}: {
  location: { href: string }
}) {
  if (!(await restoreSession()))
    throw redirect({
      to: '/',
      search: { redirect: safeRedirect(location.href) },
      replace: true,
    })
}
export async function requireDocumentAuth({
  params,
  location,
}: {
  params: { docId: string }
  location: { href: string }
}) {
  try {
    if (await restoreSession()) return
  } catch (error) {
    const offlineFailure =
      (typeof navigator !== 'undefined' && !navigator.onLine) ||
      error instanceof TypeError
    if (offlineFailure && (await restoreCachedDocument(params.docId))) return
    throw error
  }
  throw redirect({
    to: '/sign-in',
    search: { redirect: safeRedirect(location.href) },
    replace: true,
  })
}

async function restoreCachedDocument(documentID: string) {
  const auth = useAuthStore.getState().auth
  const claims = readTokenClaims(auth.accessToken)
  if (!claims) return false

  switchLocalUser(claims.sub)
  const document = useDokudocsStore
    .getState()
    .documents.find((item) => item.id === documentID)
  // A DBML or Mermaid copy is of one record; only the record last opened here counts.
  const isSource =
    document?.type === 'dbdiagram' || document?.type === 'mermaid'
  if (
    !document ||
    (document.type !== 'markdown' && !isSource) ||
    (isSource && !document.replacementId) ||
    !document.workspaceId ||
    document.deletedAt
  )
    return false

  try {
    const record = isSource ? document.replacementId : undefined
    if (!(await hasLocalCopy(document.workspaceId, documentID, record)))
      return false
  } catch {
    return false
  }
  return useAuthStore.getState().auth.enterOffline(auth.accessToken)
}

export async function requireGuest() {
  if (await restoreSession())
    throw redirect({ to: '/dashboard', replace: true })
}
