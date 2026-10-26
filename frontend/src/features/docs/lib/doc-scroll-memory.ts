export type ScrollSpot = {
  top: number
  /** The block at the top of the page, so the spot survives text loading in above it. */
  nodeId?: string
  /** How far the page sat below the top of that block. */
  offset?: number
}

const KEY = 'dokudocs:doc-scroll:'
const MAX_AGE = 7 * 24 * 3600 * 1000

/** Keeps where a person was reading, so a sign-in after the session ended can return there. */
export function rememberScroll(
  userId: string,
  docId: string,
  spot: ScrollSpot,
  now = Date.now()
) {
  try {
    sessionStorage.setItem(
      KEY + docId,
      JSON.stringify({ userId, savedAt: now, spot })
    )
  } catch {
    /* Reading still works without the saved position. */
  }
}

/** The saved spot for this person, handed out once. */
export function recallScroll(
  userId: string,
  docId: string,
  now = Date.now()
): ScrollSpot | null {
  try {
    const raw = sessionStorage.getItem(KEY + docId)
    if (!raw) return null
    sessionStorage.removeItem(KEY + docId)
    const entry = JSON.parse(raw) as {
      userId?: unknown
      savedAt?: unknown
      spot?: ScrollSpot
    }
    if (
      entry.userId !== userId ||
      typeof entry.savedAt !== 'number' ||
      now - entry.savedAt > MAX_AGE ||
      typeof entry.spot?.top !== 'number'
    )
      return null
    return entry.spot
  } catch {
    return null
  }
}
