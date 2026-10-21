/** Only web addresses are worth leaving the app for; anything else (`javascript:`, `data:`) never gets a button. */
export function isWebAddress(value: string) {
  try {
    const { protocol } = new URL(value)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}
