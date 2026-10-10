import { Link } from '@tanstack/react-router'
import { synchronizeSession, useAuthStore } from '@/stores/auth-store'
import { safeRedirect } from '@/lib/auth-guard'
import { Button } from '@/components/ui/button'
import { exchangeGoogleApi } from './api/auth-api'

/** Why Google sign-in did not finish; the code is the server's `error` value. */
export class GoogleSignInError extends Error {
  constructor(public code?: string) {
    super(googleCallbackMessage(code))
    this.name = 'GoogleSignInError'
  }
}

export function googleCallbackMessage(code?: string) {
  switch (code) {
    case 'expired':
      return 'This sign-in expired or was already used. Start again from the sign-in page.'
    case 'denied':
      return 'Google sign-in was cancelled. You can try again, or sign in with your email and password.'
    default:
      return 'Google sign-in could not be completed. Please try again.'
  }
}

let exchange: Promise<string> | undefined
/** The exchange runs once per page load; tests start each case from scratch. */
export function forgetGoogleCallback() {
  exchange = undefined
}
export function consumeGoogleCallback() {
  if (exchange) return exchange
  const search = new URLSearchParams(window.location.search)
  const code = search.get('code')
  const failure = search.get('error')
  window.history.replaceState(window.history.state, '', '/auth/callback')
  synchronizeSession()
  const revision = useAuthStore.getState().auth.revision
  exchange = (async () => {
    if (failure || !code) throw new GoogleSignInError(failure ?? undefined)
    const result = await exchangeGoogleApi(code)
    synchronizeSession()
    if (useAuthStore.getState().auth.revision !== revision)
      throw new Error('Session changed during sign-in.')
    useAuthStore.getState().auth.setSession(result)
    return safeRedirect(result.redirect)
  })()
  return exchange
}

export function GoogleCallbackError({ error }: { error?: unknown }) {
  const message = googleCallbackMessage(
    error instanceof GoogleSignInError ? error.code : undefined
  )
  return (
    <main className='grid min-h-svh place-content-center gap-4 p-6'>
      <h1 className='text-xl font-semibold'>
        Google sign-in could not be completed
      </h1>
      <p role='alert'>{message}</p>
      <Button asChild>
        <Link to='/sign-in' preload={false}>
          Back to sign in
        </Link>
      </Button>
    </main>
  )
}
