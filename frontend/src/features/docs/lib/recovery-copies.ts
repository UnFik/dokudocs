import { getUserStorage } from '@/lib/user-storage'

/**
 * A RecoveryCopy: DiagramSource this device never sent before a restore replaced
 * the record it was written on. It is kept apart from the restored document and
 * never merged back; its owner can copy or download it, then discard it.
 */
export type RecoveryCopy = {
  workspaceID: string
  documentID: string
  /** The replaced record the source was written on. */
  record: string
  title: string
  source: string
  savedAt: string
}

// Not under the `dokudocs:` prefix: sign-out clears local copies once the server
// has them, and a recovery copy is by definition something the server never got.
const keyFor = (documentID: string) => `dokudocs-recovery:${documentID}`

function read(documentID: string): RecoveryCopy[] {
  try {
    const raw = getUserStorage().getItem(keyFor(documentID))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as RecoveryCopy[]) : []
  } catch {
    return []
  }
}

function write(documentID: string, copies: RecoveryCopy[]) {
  const storage = getUserStorage()
  if (copies.length) storage.setItem(keyFor(documentID), JSON.stringify(copies))
  else storage.removeItem(keyFor(documentID))
}

/** This person's recovery copies of a document, oldest first. */
export function recoveryCopiesFor(documentID: string): RecoveryCopy[] {
  return read(documentID)
}

export function saveRecoveryCopy(copy: RecoveryCopy) {
  const others = read(copy.documentID).filter((c) => c.record !== copy.record)
  write(copy.documentID, [...others, copy])
}

export function discardRecoveryCopy(documentID: string, record: string) {
  write(
    documentID,
    read(documentID).filter((c) => c.record !== record)
  )
}
