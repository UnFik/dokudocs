export type CollaborationStatus =
  | 'connecting'
  | 'authenticating'
  | 'ready'
  | 'closed'

export type PresenceUser = {
  userID: string
  name?: string
  avatarURL?: string
}

/** A collaborator's selection. Only name and color are shared, never contact data. */
export type RemoteCursor = {
  connectionID: string
  userID: string
  name?: string
  color?: string
  anchor?: Uint8Array
  head?: Uint8Array
}

export type CursorSelection = { anchor: Uint8Array; head: Uint8Array }

export type CollaborationFrame = {
  type:
    | 'ready'
    | 'resync'
    | 'update'
    | 'ack'
    | 'error'
    | 'presence'
    | 'cursor'
    | 'cursor_leave'
    | 'comments_changed'
  code?: string
  updateID?: string
  bodyVersion?: number
  bodyEpoch?: number
  bodySchemaVersion?: number
  canEdit?: boolean
  /** The user may suggest without being able to edit. */
  canSuggest?: boolean
  state?: Uint8Array
  update?: Uint8Array
  users?: PresenceUser[]
  cursor?: RemoteCursor
}

const serverFrameTypes = [
  'ready',
  'resync',
  'update',
  'ack',
  'error',
  'presence',
  'cursor',
  'cursor_leave',
  'comments_changed',
]

type SocketLike = {
  readyState: number
  send(data: string): void
  close(): void
  addEventListener(type: string, listener: EventListener): void
  removeEventListener(type: string, listener: EventListener): void
}

type ServerEnvelope = Omit<
  CollaborationFrame,
  'state' | 'update' | 'cursor'
> & {
  cursor?: Record<string, unknown>
  state?: string
  update?: string
  pingID?: string
}

export type CollaborationSocketOptions = {
  documentID: string
  workspaceID: string
  token: string
  onFrame: (frame: CollaborationFrame) => void
  onStatus?: (status: CollaborationStatus) => void
  socketFactory?: (url: string) => SocketLike
  baseURL?: string
}

export function collaborationSocketURL(
  documentID: string,
  baseURL = window.location.href
) {
  const url = new URL(
    `/api/v1/collaboration/${encodeURIComponent(documentID)}`,
    baseURL
  )
  if (url.protocol === 'https:') url.protocol = 'wss:'
  else if (url.protocol === 'http:') url.protocol = 'ws:'
  else throw new Error('collaboration requires an HTTP(S) origin')
  return url.href
}

export class CollaborationSocket {
  private readonly socket: SocketLike
  private ready = false
  private closed = false
  private readonly onOpen = () => {
    this.options.onStatus?.('authenticating')
    this.socket.send(
      JSON.stringify({
        type: 'auth',
        token: this.options.token,
        workspaceID: this.options.workspaceID,
        capabilities: ['presence', 'cursor', 'comments'],
      })
    )
  }
  private readonly onMessage = (event: Event) => {
    if (!(event instanceof MessageEvent) || typeof event.data !== 'string')
      return
    let message: unknown
    try {
      message = JSON.parse(event.data)
    } catch {
      this.socket.close()
      return
    }
    if (!isRecord(message)) {
      this.socket.close()
      return
    }
    if (message.type === 'ping') {
      if (typeof message.pingID !== 'string' || !message.pingID) {
        this.socket.close()
        return
      }
      this.socket.send(JSON.stringify({ type: 'pong', pingID: message.pingID }))
      return
    }
    // A newer server may send frame types this client predates; skip them.
    if (
      typeof message.type === 'string' &&
      !serverFrameTypes.includes(message.type)
    )
      return
    if (!isServerEnvelope(message)) {
      this.socket.close()
      return
    }
    let frame: CollaborationFrame
    try {
      frame = {
        ...message,
        cursor: message.cursor ? decodeCursor(message.cursor) : undefined,
        state: message.state ? decodeBase64(message.state) : undefined,
        update: message.update ? decodeBase64(message.update) : undefined,
      }
      if (frame.cursor === undefined) delete frame.cursor
    } catch {
      this.socket.close()
      return
    }
    if (frame.type === 'ready') {
      this.ready = true
      this.options.onStatus?.('ready')
    }
    this.options.onFrame(frame)
  }
  private readonly onClose = () => {
    this.ready = false
    this.closed = true
    this.options.onStatus?.('closed')
    this.removeListeners()
  }
  private readonly onError = () => this.socket.close()

  constructor(private readonly options: CollaborationSocketOptions) {
    const url = collaborationSocketURL(options.documentID, options.baseURL)
    this.socket = (options.socketFactory ?? ((value) => new WebSocket(value)))(
      url
    )
    options.onStatus?.('connecting')
    this.socket.addEventListener('open', this.onOpen)
    this.socket.addEventListener('message', this.onMessage)
    this.socket.addEventListener('close', this.onClose)
    this.socket.addEventListener('error', this.onError)
  }

  sendUpdate(input: {
    updateID: string
    bodyEpoch: number
    bodySchemaVersion: number
    update: Uint8Array
  }) {
    if (
      !input.updateID ||
      input.bodyEpoch < 1 ||
      input.bodySchemaVersion < 1 ||
      !Number.isInteger(input.bodyEpoch) ||
      !Number.isInteger(input.bodySchemaVersion) ||
      input.update.length === 0
    )
      throw new Error('invalid collaboration update')
    if (!this.ready || this.closed || this.socket.readyState !== WebSocket.OPEN)
      return false
    this.socket.send(
      JSON.stringify({
        type: 'update',
        updateID: input.updateID,
        bodyEpoch: input.bodyEpoch,
        bodySchemaVersion: input.bodySchemaVersion,
        update: encodeBase64(input.update),
      })
    )
    return true
  }

  /** Shares the local selection; null clears it. Dropped when not ready. */
  sendCursor(selection: CursorSelection | null) {
    if (!this.ready || this.closed || this.socket.readyState !== WebSocket.OPEN)
      return false
    this.socket.send(
      JSON.stringify(
        selection
          ? {
              type: 'cursor',
              cursor: {
                anchor: encodeBase64(selection.anchor),
                head: encodeBase64(selection.head),
              },
            }
          : { type: 'cursor' }
      )
    )
    return true
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.ready = false
    this.removeListeners()
    this.socket.close()
    this.options.onStatus?.('closed')
  }

  private removeListeners() {
    this.socket.removeEventListener('open', this.onOpen)
    this.socket.removeEventListener('message', this.onMessage)
    this.socket.removeEventListener('close', this.onClose)
    this.socket.removeEventListener('error', this.onError)
  }
}

function isServerEnvelope(value: unknown): value is ServerEnvelope {
  if (
    !isRecord(value) ||
    typeof value.type !== 'string' ||
    !serverFrameTypes.includes(value.type)
  )
    return false
  if (value.code !== undefined && typeof value.code !== 'string') return false
  if (value.updateID !== undefined && typeof value.updateID !== 'string')
    return false
  if (value.state !== undefined && typeof value.state !== 'string') return false
  if (value.update !== undefined && typeof value.update !== 'string')
    return false
  if (value.canEdit !== undefined && typeof value.canEdit !== 'boolean')
    return false
  if (value.canSuggest !== undefined && typeof value.canSuggest !== 'boolean')
    return false
  for (const key of ['bodyVersion', 'bodyEpoch', 'bodySchemaVersion']) {
    const number = value[key]
    if (
      number !== undefined &&
      (typeof number !== 'number' || !Number.isInteger(number) || number < 1)
    )
      return false
  }
  switch (value.type) {
    case 'ready':
    case 'resync':
      return (
        typeof value.state === 'string' &&
        value.bodyVersion !== undefined &&
        value.bodyEpoch !== undefined &&
        value.bodySchemaVersion !== undefined &&
        typeof value.canEdit === 'boolean'
      )
    case 'update':
      return (
        typeof value.updateID === 'string' &&
        typeof value.update === 'string' &&
        value.bodyVersion !== undefined &&
        value.bodyEpoch !== undefined &&
        value.bodySchemaVersion !== undefined
      )
    case 'ack':
      return (
        typeof value.updateID === 'string' &&
        value.bodyVersion !== undefined &&
        value.bodyEpoch !== undefined &&
        value.bodySchemaVersion !== undefined
      )
    case 'error':
      return typeof value.code === 'string'
    case 'cursor':
    case 'cursor_leave':
      return (
        isRecord(value.cursor) &&
        typeof value.cursor.connectionID === 'string' &&
        value.cursor.connectionID !== '' &&
        typeof value.cursor.userID === 'string' &&
        value.cursor.userID !== '' &&
        (value.cursor.name === undefined ||
          typeof value.cursor.name === 'string') &&
        (value.cursor.color === undefined ||
          typeof value.cursor.color === 'string') &&
        (value.type === 'cursor_leave' ||
          (typeof value.cursor.anchor === 'string' &&
            typeof value.cursor.head === 'string'))
      )
    // A hint that comments changed; it names nothing.
    case 'comments_changed':
      return true
    case 'presence':
      return (
        Array.isArray(value.users) &&
        value.users.every(
          (user) =>
            isRecord(user) &&
            typeof user.userID === 'string' &&
            user.userID !== '' &&
            (user.name === undefined || typeof user.name === 'string') &&
            (user.avatarURL === undefined || typeof user.avatarURL === 'string')
        )
      )
    default:
      return false
  }
}

// Copies the known fields only, so a newer server cannot leak extra data
// into the UI through this frame.
function decodeCursor(raw: Record<string, unknown>): RemoteCursor {
  const cursor: RemoteCursor = {
    connectionID: raw.connectionID as string,
    userID: raw.userID as string,
  }
  if (typeof raw.name === 'string') cursor.name = raw.name
  if (typeof raw.color === 'string') cursor.color = raw.color
  if (typeof raw.anchor === 'string') cursor.anchor = decodeBase64(raw.anchor)
  if (typeof raw.head === 'string') cursor.head = decodeBase64(raw.head)
  return cursor
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function encodeBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  return btoa(binary)
}

export function decodeBase64(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}
