import { describe, expect, it } from 'vitest'
import {
  CollaborationSocket,
  collaborationSocketURL,
} from './collaboration-socket'

class FakeSocket extends EventTarget {
  readyState = 0
  sent: string[] = []

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }

  open() {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }

  receive(message: unknown) {
    this.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify(message) })
    )
  }
}

describe('CollaborationSocket', () => {
  it('uses same-origin ws(s) endpoint and keeps token out of the URL', () => {
    expect(
      collaborationSocketURL('doc/id', 'https://docs.example.test/path')
    ).toBe('wss://docs.example.test/api/v1/collaboration/doc%2Fid')
  })

  it('authenticates, responds to heartbeat, and encodes Yjs update bytes', () => {
    const socket = new FakeSocket()
    const frames: unknown[] = []
    const statuses: string[] = []
    let socketURL = ''
    const client = new CollaborationSocket({
      documentID: 'doc-1',
      workspaceID: 'workspace-1',
      token: 'secret-token',
      baseURL: 'http://localhost:5173',
      socketFactory: (url) => {
        socketURL = url
        return socket
      },
      onFrame: (frame) => frames.push(frame),
      onStatus: (status) => statuses.push(status),
    })

    expect(
      client.sendUpdate({
        updateID: 'update-1',
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        update: new Uint8Array([1, 2, 3]),
      })
    ).toBe(false)
    socket.open()
    expect(JSON.parse(socket.sent[0]!)).toEqual({
      type: 'auth',
      token: 'secret-token',
      workspaceID: 'workspace-1',
      capabilities: ['presence', 'cursor', 'comments'],
    })
    expect(socketURL).not.toContain('secret-token')

    socket.receive({
      type: 'ready',
      bodyVersion: 2,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      canEdit: true,
      state: 'YQ==',
    })
    expect(statuses).toEqual(['connecting', 'authenticating', 'ready'])
    expect(frames).toEqual([
      expect.objectContaining({ type: 'ready', state: new Uint8Array([97]) }),
    ])

    socket.receive({
      type: 'update',
      updateID: 'remote-update',
      bodyVersion: 3,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      update: 'AQID',
    })
    expect(frames.at(-1)).toEqual(
      expect.objectContaining({
        type: 'update',
        updateID: 'remote-update',
        update: new Uint8Array([1, 2, 3]),
      })
    )

    socket.receive({ type: 'ping', pingID: 'ping-1' })
    expect(JSON.parse(socket.sent[1]!)).toEqual({
      type: 'pong',
      pingID: 'ping-1',
    })
    expect(
      client.sendUpdate({
        updateID: 'update-1',
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        update: new Uint8Array([1, 2, 3]),
      })
    ).toBe(true)
    expect(JSON.parse(socket.sent[2]!)).toEqual({
      type: 'update',
      updateID: 'update-1',
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      update: 'AQID',
    })

    client.close()
    expect(statuses.at(-1)).toBe('closed')
  })

  it('forwards presence frames and rejects malformed ones', () => {
    const socket = new FakeSocket()
    const frames: unknown[] = []
    new CollaborationSocket({
      documentID: 'doc-1',
      workspaceID: 'workspace-1',
      token: 'secret-token',
      baseURL: 'http://localhost:5173',
      socketFactory: () => socket,
      onFrame: (frame) => frames.push(frame),
    })
    socket.open()

    socket.receive({
      type: 'presence',
      users: [
        { userID: 'user-1', name: 'Ada', avatarURL: '/ada.png' },
        { userID: 'user-2' },
      ],
    })
    expect(frames).toEqual([
      {
        type: 'presence',
        users: [
          { userID: 'user-1', name: 'Ada', avatarURL: '/ada.png' },
          { userID: 'user-2' },
        ],
        state: undefined,
        update: undefined,
      },
    ])
    expect(socket.readyState).toBe(1)

    socket.receive({ type: 'presence', users: [{ name: 'no id' }] })
    expect(socket.readyState).toBe(3)
  })

  it('decodes remote cursor frames, drops unknown fields, and rejects malformed ones', () => {
    const socket = new FakeSocket()
    const frames: unknown[] = []
    new CollaborationSocket({
      documentID: 'doc-1',
      workspaceID: 'workspace-1',
      token: 'secret-token',
      baseURL: 'http://localhost:5173',
      socketFactory: () => socket,
      onFrame: (frame) => frames.push(frame),
    })
    socket.open()

    socket.receive({
      type: 'cursor',
      cursor: {
        connectionID: 'conn-1',
        userID: 'user-1',
        name: 'Ada',
        color: '#0369A1',
        anchor: 'AQI=',
        head: 'AwQ=',
        email: 'ada@example.test',
      },
    })
    expect(frames.at(-1)).toEqual(
      expect.objectContaining({
        type: 'cursor',
        cursor: {
          connectionID: 'conn-1',
          userID: 'user-1',
          name: 'Ada',
          color: '#0369A1',
          anchor: new Uint8Array([1, 2]),
          head: new Uint8Array([3, 4]),
        },
      })
    )

    socket.receive({
      type: 'cursor_leave',
      cursor: { connectionID: 'conn-1', userID: 'user-1' },
    })
    expect(frames.at(-1)).toEqual(
      expect.objectContaining({
        type: 'cursor_leave',
        cursor: { connectionID: 'conn-1', userID: 'user-1' },
      })
    )
    expect(socket.readyState).toBe(1)

    socket.receive({ type: 'cursor', cursor: { userID: 'user-1' } })
    expect(socket.readyState).toBe(3)
  })

  it('passes a comments_changed hint on and keeps the connection', () => {
    const socket = new FakeSocket()
    const frames: { type: string }[] = []
    new CollaborationSocket({
      documentID: 'doc-1',
      workspaceID: 'workspace-1',
      token: 'secret-token',
      baseURL: 'http://localhost:5173',
      socketFactory: () => socket,
      onFrame: (frame) => frames.push(frame),
    })
    socket.open()

    socket.receive({ type: 'comments_changed' })

    expect(frames.map((frame) => frame.type)).toEqual(['comments_changed'])
    expect(socket.readyState).toBe(1)
  })

  it('sends the local selection as base64 positions and clears it with null', () => {
    const socket = new FakeSocket()
    const client = new CollaborationSocket({
      documentID: 'doc-1',
      workspaceID: 'workspace-1',
      token: 'secret-token',
      baseURL: 'http://localhost:5173',
      socketFactory: () => socket,
      onFrame: () => {},
    })
    socket.open()
    expect(
      client.sendCursor({
        anchor: new Uint8Array([1]),
        head: new Uint8Array([2]),
      })
    ).toBe(false)

    socket.receive({
      type: 'ready',
      bodyVersion: 1,
      bodyEpoch: 1,
      bodySchemaVersion: 1,
      canEdit: true,
      state: 'YQ==',
    })
    const sentBefore = socket.sent.length
    expect(
      client.sendCursor({
        anchor: new Uint8Array([1, 2]),
        head: new Uint8Array([3, 4]),
      })
    ).toBe(true)
    expect(JSON.parse(socket.sent[sentBefore]!)).toEqual({
      type: 'cursor',
      cursor: { anchor: 'AQI=', head: 'AwQ=' },
    })
    expect(client.sendCursor(null)).toBe(true)
    expect(JSON.parse(socket.sent[sentBefore + 1]!)).toEqual({
      type: 'cursor',
    })
  })

  it('ignores frame types it does not know instead of dropping the connection', () => {
    const socket = new FakeSocket()
    const frames: unknown[] = []
    new CollaborationSocket({
      documentID: 'doc-1',
      workspaceID: 'workspace-1',
      token: 'secret-token',
      baseURL: 'http://localhost:5173',
      socketFactory: () => socket,
      onFrame: (frame) => frames.push(frame),
    })
    socket.open()

    socket.receive({ type: 'from-the-future', value: 1 })

    expect(socket.readyState).toBe(1)
    expect(frames).toEqual([])
  })
})
