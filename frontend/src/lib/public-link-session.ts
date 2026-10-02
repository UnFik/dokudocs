const STORAGE_KEY = 'dokudocs.rag.opened-public-link-tokens'
const MAX_TOKENS = 20

export function rememberOpenedPublicLink(token: string) {
  if (!token || typeof window === 'undefined') return
  try {
    const existing = getOpenedPublicLinkTokens()
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([...new Set([...existing, token])].slice(-MAX_TOKENS))
    )
  } catch {
    // Public document reading must continue when session storage is unavailable.
  }
}

export function getOpenedPublicLinkTokens(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const stored: unknown = JSON.parse(
      window.sessionStorage.getItem(STORAGE_KEY) ?? '[]'
    )
    return Array.isArray(stored)
      ? stored
          .filter(
            (token): token is string =>
              typeof token === 'string' && token.length > 0
          )
          .slice(-MAX_TOKENS)
      : []
  } catch {
    return []
  }
}
