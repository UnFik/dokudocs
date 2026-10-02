import { Link } from '@tanstack/react-router'
import { synchronizeSession, useAuthStore } from '@/stores/auth-store'
import { safeRedirect } from '@/lib/auth-guard'
import { Button } from '@/components/ui/button'
import { exchangeGoogleApi } from './api/auth-api'

let exchange: Promise<string> | undefined
export function consumeGoogleCallback() {
  if (exchange) return exchange
  const search = new URLSearchParams(window.location.search)
  const code = search.get('code')
  const denied = search.has('error')
  window.history.replaceState(window.history.state, '', '/auth/callback')
  synchronizeSession()
  const revision = useAuthStore.getState().auth.revision
  exchange = (async () => {
    if (!code || denied) throw new Error('Google sign-in was not completed.')
    const result = await exchangeGoogleApi(code)
    synchronizeSession()
    if (useAuthStore.getState().auth.revision !== revision)
      throw new Error('Session changed during sign-in.')
    useAuthStore.getState().auth.setSession(result)
    return safeRedirect(result.redirect)
  })()
  return exchange
}

export function GoogleCallbackError() {
  return (
    <main className='grid min-h-svh place-content-center gap-4 p-6'>
      <h1 className='text-xl font-semibold'>
        Google sign-in could not be completed
      </h1>
      <p role='alert'>
        The request may have expired or been declined. Please start sign-in
        again.
      </p>
      <Button asChild>
        <Link to='/sign-in' preload={false}>
          Back to sign in
        </Link>
      </Button>
    </main>
  )
}
