import { synchronizeSession, useAuthStore } from '@/stores/auth-store'
import { verifyEmailApi } from '../api/auth-api'

/** The link was refused: unknown, used, replaced or expired. */
export class VerificationLinkError extends Error {
  constructor() {
    super('This link is invalid or has expired.')
    this.name = 'VerificationLinkError'
  }
}

let verification: Promise<boolean> | undefined
/** The link works once per page load; tests start each case from scratch. */
export function forgetVerificationLink() {
  verification = undefined
}

/**
 * Uses the `token` in the address, if there is one: takes it out of the address
 * first, then asks the server and signs the User in as verified. Resolves true
 * when a link was used and false when there was none.
 */
export function consumeVerificationLink() {
  if (verification) return verification
  const token = new URLSearchParams(window.location.search).get('token')
  if (!token) return Promise.resolve(false)
  window.history.replaceState(window.history.state, '', '/verify-email')
  synchronizeSession()
  const revision = useAuthStore.getState().auth.revision
  verification = (async () => {
    let result
    try {
      result = await verifyEmailApi(token)
    } catch {
      throw new VerificationLinkError()
    }
    synchronizeSession()
    if (useAuthStore.getState().auth.revision !== revision)
      throw new Error('Session changed during verification.')
    useAuthStore.getState().auth.setSession(result)
    return true
  })()
  return verification
}
