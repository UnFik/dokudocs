const KEY = 'dokudocs.pendingInvite'

// The link token waits here while the person signs in, signs up or verifies
// their email. It lives in the tab only, and never in a URL that history keeps.
function store() {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function rememberInvite(token: string) {
  try {
    store()?.setItem(KEY, token)
  } catch {
    /* Without storage the link still works once, in the same page load. */
  }
}

export function recallInvite() {
  try {
    return store()?.getItem(KEY) || null
  } catch {
    return null
  }
}

export function forgetInvite() {
  try {
    store()?.removeItem(KEY)
  } catch {
    /* Nothing was kept. */
  }
}

/**
 * Takes the `token` out of the address bar into storage, so it is not left in
 * history or shared by copying the page address. Resolves to the token in use.
 */
export function takeInviteFromAddress() {
  const token = new URLSearchParams(window.location.search).get('token')
  if (token) {
    rememberInvite(token)
    window.history.replaceState(window.history.state, '', '/invite')
  }
  return recallInvite()
}
