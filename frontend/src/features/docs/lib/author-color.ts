// One color per person, the same one the backend gives their cursor
// (websocket/cursor.go: FNV-1a over the UUID's 16 bytes, modulo the palette), so
// a collaborator looks the same in the cursor, the avatar's suggestion cards, and
// the text they suggested. Used for lines and outlines, never as text color.
const palette = [
  '#0369A1',
  '#B45309',
  '#15803D',
  '#B91C1C',
  '#7C3AED',
  '#0F766E',
  '#BE185D',
  '#4D7C0F',
]

function uuidBytes(userID: string): number[] | null {
  const hex = userID.replaceAll('-', '')
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) return null
  return Array.from({ length: 16 }, (_, index) =>
    parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  )
}

function fnv1a(bytes: number[]) {
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

export function authorColor(userID: string) {
  const bytes =
    uuidBytes(userID) ?? Array.from(new TextEncoder().encode(userID))
  return palette[fnv1a(bytes) % palette.length]!
}
