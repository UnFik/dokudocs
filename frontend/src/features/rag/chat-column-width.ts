/** Width of the document chat column in pixels, from `sm` up; below that it covers the page. */
export const CHAT_COLUMN_WIDTH = { min: 320, default: 384, max: 640 } as const

export function clampChatColumnWidth(width: number): number {
  return Math.round(
    Math.min(CHAT_COLUMN_WIDTH.max, Math.max(CHAT_COLUMN_WIDTH.min, width))
  )
}

const WIDTH_KEY = 'dokudocs.askAIPanelWidth'

/** The width this User last left the column at, kept across documents. */
export function readColumnWidth(userID: string): number {
  try {
    const stored = Number(localStorage.getItem(`${WIDTH_KEY}:${userID}`))
    return stored ? clampChatColumnWidth(stored) : CHAT_COLUMN_WIDTH.default
  } catch {
    return CHAT_COLUMN_WIDTH.default
  }
}

export function writeColumnWidth(userID: string, width: number) {
  try {
    localStorage.setItem(`${WIDTH_KEY}:${userID}`, String(width))
  } catch {
    // Private windows and blocked storage: the column just starts at the default next time.
  }
}
