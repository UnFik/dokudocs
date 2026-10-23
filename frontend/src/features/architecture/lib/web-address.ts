/** Only web addresses are worth leaving the app for; anything else (`javascript:`, `data:`) never gets a button. */
export function isWebAddress(value: string) {
  // Most Systems have no address; a URL that fails to parse throws, which is slow on every draw.
  if (!/^https?:/i.test(value)) return false
  try {
    const { protocol } = new URL(value)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}
