const PATH = '/settings/account/set-password'

let taken: string | null | undefined
/** The link works once per page load; tests start each case from scratch. */
export function forgetPasswordLinkToken() {
  taken = undefined
}

/**
 * Reads the `token` from the address and takes it out of the address at once, so
 * it is not left in the history or sent on as a referrer. It is remembered for
 * the life of the page: a second call (React rendering twice) gets the same one.
 */
export function takePasswordLinkToken() {
  if (taken !== undefined) return taken
  const params = new URLSearchParams(window.location.search)
  taken = params.get('token')
  if (taken) window.history.replaceState(window.history.state, '', PATH)
  return taken
}
