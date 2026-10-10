import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import {
  createDocument,
  createDocumentShareToken,
  createRAGConversation,
  createWorkspace,
  deleteRAGConversation,
  getPublicDocument,
  getRAGConversation,
  listDocuments,
  listDocumentSuggestions,
  listDocumentComments,
  createDocumentComment,
  setDocumentCommentResolved,
  editDocumentComment,
  deleteDocumentComment,
  editDocumentCommentReply,
  deleteDocumentCommentReply,
  listProjects,
  listRAGConversations,
  listWorkspaceMembers,
  listWorkspaces,
  askRAGQuestion,
} from './domain-api'

const workspaceId = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const legacyDemoWorkspaceId = '00000000-0000-0000-0000-000000000010'
const documentId = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const requestID = 'd2bd52f1-e274-4119-af61-737b0e8c80a9'

beforeEach(() => useAuthStore.getState().auth.setSession(testSession()))
afterEach(() => {
  vi.unstubAllGlobals()
  window.sessionStorage.clear()
  useAuthStore.getState().auth.reset()
})

describe('Dokudocs domain API adapter', () => {
  it('keeps RAG history private and scopes new questions to a workspace', async () => {
    const conversationID = '65b7593c-3a2d-45a4-a47d-47e8a1c8136b'
    const citation = {
      documentId,
      nodeId: requestID,
      bodyVersion: 4,
      sourceFingerprint: 'source-v4',
      quotedText: 'The runbook says restart the service.',
      breadcrumb: 'Operations / Recovery',
      ordinal: 0,
    }
    const conversation = {
      id: conversationID,
      workspaceId,
      creatorId: testSession().user.id,
      title: 'Recovery policy',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    }
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([conversation]))
      .mockResolvedValueOnce(
        jsonResponse({
          conversation,
          messages: [
            {
              id: requestID,
              conversationId: conversationID,
              role: 'assistant',
              content: 'Restart the service.',
              citations: [citation],
              coveragePartial: false,
              sourcesMayBeIncomplete: true,
              createdAt: '2026-10-01T00:00:00.000Z',
            },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse(conversation, 201))
      .mockResolvedValueOnce(
        jsonResponse({
          conversationId: conversationID,
          text: 'Restart the service.',
          citations: [citation],
          coveragePartial: false,
          sourcesMayBeIncomplete: true,
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)

    await expect(listRAGConversations()).resolves.toHaveLength(1)
    await expect(getRAGConversation(conversationID)).resolves.toMatchObject({
      messages: [
        { content: 'Restart the service.', sourcesMayBeIncomplete: true },
      ],
    })
    await expect(createRAGConversation(workspaceId)).resolves.toMatchObject({
      id: conversationID,
    })
    await expect(
      askRAGQuestion(workspaceId, conversationID, {
        question: 'What is the recovery policy?',
        language: 'en',
        publicLinkTokens: ['opened-public-token'],
      })
    ).resolves.toMatchObject({
      sourcesMayBeIncomplete: true,
      citations: [expect.objectContaining({ nodeId: requestID })],
    })
    await expect(deleteRAGConversation(conversationID)).resolves.toBeUndefined()

    const calls = fetch.mock.calls as Array<[string, RequestInit]>
    expect(new URL(calls[0][0]).pathname).toBe('/api/v1/rag/conversations')
    expect(new Headers(calls[0][1].headers).has('X-Workspace-Id')).toBe(false)
    expect(new URL(calls[1][0]).pathname).toBe(
      `/api/v1/rag/conversations/${conversationID}`
    )
    expect(new Headers(calls[1][1].headers).has('X-Workspace-Id')).toBe(false)
    expect(new Headers(calls[2][1].headers).get('X-Workspace-Id')).toBe(
      workspaceId
    )
    expect(new Headers(calls[3][1].headers).get('X-Workspace-Id')).toBe(
      workspaceId
    )
    expect(JSON.parse(String(calls[3][1].body))).toEqual({
      question: 'What is the recovery policy?',
      language: 'en',
      publicLinkTokens: ['opened-public-token'],
    })
    expect(new Headers(calls[4][1].headers).has('X-Workspace-Id')).toBe(false)
  })

  it('lists suggestions decided by the seeded system user, whose id is not an RFC UUID', async () => {
    const seededUser = '00000000-0000-0000-0000-000000000001'
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          documentId: documentId,
          suggestionId: '11111111-1111-4111-8111-111111111111',
          proposerId: '22222222-2222-4222-8222-222222222222',
          deciderId: seededUser,
          conflictReason: 'base',
          status: 'conflicted',
          createdAt: '2026-10-02T00:00:00Z',
        },
      ])
    )
    vi.stubGlobal('fetch', fetch)

    const [suggestion] = await listDocumentSuggestions(workspaceId, documentId)
    expect(suggestion?.deciderId).toBe(seededUser)
    expect(suggestion?.conflictReason).toBe('base')
  })

  it('lists comment threads, reading a malformed or missing anchor as none', async () => {
    const thread = {
      id: '11111111-1111-4111-8111-111111111111',
      documentId,
      authorId: '22222222-2222-4222-8222-222222222222',
      authorName: 'Dewi',
      selectedText: 'plain',
      content: 'is this right?',
      createdAt: '2026-10-03T00:00:00Z',
      replies: null,
    }
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse([
        { ...thread, anchor: { nodeID: 'n1', start: 'AA==', end: 'AQ==' } },
        { ...thread, id: '33333333-3333-4333-8333-333333333333' },
        {
          ...thread,
          id: '44444444-4444-4444-8444-444444444444',
          anchor: { nodeID: 'n1' },
        },
      ])
    )
    vi.stubGlobal('fetch', fetch)

    const threads = await listDocumentComments(workspaceId, documentId)

    expect(threads.map((item) => item.anchor?.nodeID ?? null)).toEqual([
      'n1',
      null,
      null,
    ])
    expect(threads[0]?.replies).toEqual([])
    expect(String(fetch.mock.calls[0]![0])).toContain(
      `/documents/${documentId}/comments`
    )
  })

  it('reads where a comment sits in a DBML or Mermaid source', async () => {
    const thread = {
      id: '11111111-1111-4111-8111-111111111111',
      documentId,
      authorId: '22222222-2222-4222-8222-222222222222',
      authorName: 'Dewi',
      selectedText: 'users',
      content: 'rename this table?',
      createdAt: '2026-10-10T00:00:00Z',
      replies: [],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse([
          { ...thread, anchor: { kind: 'source', start: 'AA==', end: 'AQ==' } },
          {
            ...thread,
            id: '33333333-3333-4333-8333-333333333333',
            anchor: { kind: 'source', start: 'AA==' },
          },
        ])
      )
    )

    const threads = await listDocumentComments(workspaceId, documentId)

    expect(threads[0]?.sourceAnchor).toEqual({
      kind: 'source',
      start: 'AA==',
      end: 'AQ==',
    })
    expect(threads[0]?.anchor).toBeNull()
    expect(threads[1]?.sourceAnchor).toBeUndefined()
  })

  it('starts a comment thread with the client id and resolves it', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 201 }))
    vi.stubGlobal('fetch', fetch)
    const threadID = '11111111-1111-4111-8111-111111111111'

    await createDocumentComment(workspaceId, documentId, {
      threadID,
      selectedText: 'plain',
      content: 'why?',
      anchor: { nodeID: 'n1', start: 'AA==', end: 'AQ==' },
    })
    await setDocumentCommentResolved(workspaceId, documentId, threadID, true)
    await setDocumentCommentResolved(workspaceId, documentId, threadID, false)

    const [create, resolve, reopen] = fetch.mock.calls as [
      string,
      RequestInit,
    ][]
    expect(String(create[0])).toContain(`/documents/${documentId}/comments`)
    expect(JSON.parse(String(create[1].body))).toMatchObject({
      threadID,
      content: 'why?',
    })
    expect(String(resolve[0])).toMatch(/comments\/.+\/resolve$/)
    expect(String(reopen[0])).toMatch(/comments\/.+\/reopen$/)
  })

  it('edits and deletes comments and replies with the right method and path', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    const thread = '11111111-1111-4111-8111-111111111111'
    const reply = '22222222-2222-4222-8222-222222222222'

    await editDocumentComment(workspaceId, documentId, thread, 'fixed')
    await deleteDocumentComment(workspaceId, documentId, thread)
    await editDocumentCommentReply(
      workspaceId,
      documentId,
      thread,
      reply,
      'better'
    )
    await deleteDocumentCommentReply(workspaceId, documentId, thread, reply)

    const calls = (fetch.mock.calls as [string, RequestInit][]).map(
      ([url, init]) => [init.method, new URL(String(url), 'http://x').pathname]
    )
    expect(calls).toEqual([
      ['PATCH', `/api/v1/documents/${documentId}/comments/${thread}`],
      ['DELETE', `/api/v1/documents/${documentId}/comments/${thread}`],
      [
        'PATCH',
        `/api/v1/documents/${documentId}/comments/${thread}/replies/${reply}`,
      ],
      [
        'DELETE',
        `/api/v1/documents/${documentId}/comments/${thread}/replies/${reply}`,
      ],
    ])
    expect(
      JSON.parse(String((fetch.mock.calls[0] as [string, RequestInit])[1].body))
    ).toEqual({ content: 'fixed' })
  })

  it('requests a public share token with workspace scope', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ shareToken: 'opaque-share-token' }))
    vi.stubGlobal('fetch', fetch)

    await expect(
      createDocumentShareToken(workspaceId, documentId)
    ).resolves.toBe('opaque-share-token')
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(new URL(url).pathname).toBe(
      `/api/v1/documents/${documentId}/share-token`
    )
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('X-Workspace-Id')).toBe(workspaceId)
  })

  it('loads public document metadata without sending an access token', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        id: documentId,
        workspaceId,
        projectId: null,
        title: 'Shared Markdown',
        type: 'markdown',
        content: '',
        authorId: testSession().user.id,
        author: {
          id: testSession().user.id,
          name: 'Test User',
          email: 'user@example.com',
          avatar: '',
        },
        tags: [],
        isDraft: false,
        visibility: 'public_link',
        isShared: true,
        categories: [],
        createdAt: '2026-09-28T00:00:00.000Z',
        updatedAt: '2026-09-28T00:00:00.000Z',
      })
    )
    vi.stubGlobal('fetch', fetch)

    await expect(getPublicDocument('opaque token')).resolves.toMatchObject({
      id: documentId,
      title: 'Shared Markdown',
      content: '',
    })
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(new URL(url).pathname).toBe(
      '/api/v1/public/documents/opaque%20token'
    )
    expect(new Headers(init.headers).has('Authorization')).toBe(false)
  })

  it('lists the people of a workspace', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          workspaceId,
          userId: '00000000-0000-0000-0000-000000000001',
          email: 'rina@example.com',
          fullName: 'Rina Putri',
          avatarUrl: '',
          role: 'member',
          joinedAt: '2026-10-01T00:00:00Z',
        },
      ])
    )
    vi.stubGlobal('fetch', fetch)

    await expect(listWorkspaceMembers(workspaceId)).resolves.toEqual([
      {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Rina Putri',
        email: 'rina@example.com',
      },
    ])
    expect(new URL(fetch.mock.calls[0][0]).pathname).toBe(
      `/api/v1/workspaces/${workspaceId}/members`
    )
  })

  it('loads workspaces from the backend and rejects malformed rows', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          id: workspaceId,
          name: 'Engineering',
          plan: 'Free',
          logoUrl: '',
          role: 'owner',
        },
      ])
    )
    vi.stubGlobal('fetch', fetch)

    await expect(listWorkspaces()).resolves.toEqual([
      expect.objectContaining({
        id: workspaceId,
        name: 'Engineering',
        role: 'owner',
      }),
    ])
    expect(new URL(fetch.mock.calls[0][0]).pathname).toBe('/api/v1/workspaces')

    fetch.mockResolvedValueOnce(jsonResponse([{ id: 'org-1', name: 'bad' }]))
    await expect(listWorkspaces()).rejects.toThrow()
  })

  it('accepts the PostgreSQL UUID used by the legacy demo workspace', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          id: legacyDemoWorkspaceId,
          name: 'Demo workspace',
          plan: 'Free',
          logoUrl: '',
          role: 'owner',
        },
      ])
    )
    vi.stubGlobal('fetch', fetch)

    await expect(listWorkspaces()).resolves.toMatchObject([
      { id: legacyDemoWorkspaceId, name: 'Demo workspace' },
    ])
  })

  it('creates a workspace through the API', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          id: workspaceId,
          name: 'New workspace',
          plan: 'Free',
          logoUrl: '',
          role: 'owner',
        },
        201
      )
    )
    vi.stubGlobal('fetch', fetch)

    await expect(
      createWorkspace({ name: 'New workspace' })
    ).resolves.toMatchObject({
      id: workspaceId,
      name: 'New workspace',
    })
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(new URL(url).pathname).toBe('/api/v1/workspaces')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ name: 'New workspace' })
    expect(new Headers(init.headers).has('X-Workspace-Id')).toBe(false)
  })

  it('sends workspace scope and filters when listing documents', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          id: documentId,
          workspaceId,
          projectId: null,
          title: 'Invoice flow',
          type: 'markdown',
          content: '# Invoice flow',
          authorId: testSession().user.id,
          author: {
            id: testSession().user.id,
            name: 'Test User',
            email: 'user@example.com',
            avatar: '',
          },
          tags: [],
          isDraft: false,
          visibility: 'workspace',
          isStarred: false,
          isShared: false,
          categories: [],
          createdAt: '2026-09-28T00:00:00.000Z',
          updatedAt: '2026-09-28T00:00:00.000Z',
        },
      ])
    )
    vi.stubGlobal('fetch', fetch)

    const docs = await listDocuments(workspaceId, {
      search: 'invoice & refunds',
      sortField: 'title',
      sortOrder: 'asc',
    })

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/documents?')
    expect(url).toContain('search=invoice+%26+refunds')
    expect(url).toContain('sortField=title')
    expect(new Headers(init.headers).get('X-Workspace-Id')).toBe(workspaceId)
    expect(docs[0]).toMatchObject({
      id: documentId,
      orgId: workspaceId,
      workspaceId,
    })
  })

  it('accepts legacy demo workspace IDs on document rows', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          id: documentId,
          workspaceId: legacyDemoWorkspaceId,
          projectId: null,
          title: 'Legacy Markdown',
          type: 'markdown',
          content: '# Legacy Markdown',
          authorId: testSession().user.id,
          author: {
            id: testSession().user.id,
            name: 'Test User',
            email: 'user@example.com',
            avatar: '',
          },
          tags: [],
          isDraft: false,
          visibility: 'workspace',
          isStarred: false,
          isShared: false,
          categories: [],
          createdAt: '2026-09-28T00:00:00.000Z',
          updatedAt: '2026-09-28T00:00:00.000Z',
        },
      ])
    )
    vi.stubGlobal('fetch', fetch)

    await expect(listDocuments(legacyDemoWorkspaceId)).resolves.toMatchObject([
      { id: documentId, workspaceId: legacyDemoWorkspaceId },
    ])
  })

  it('maps project category rows and workspace IDs to the current UI model', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          id: '25b75242-69f9-4b53-8b49-c274e7d98130',
          workspaceId,
          name: 'Platform',
          description: 'Platform docs',
          logoUrl: '',
          colorBadge: '#2563eb',
          categories: [
            {
              id: 'c11c1937-8eb1-4e59-bad6-264d8839ac85',
              name: 'Specs',
              colorId: 'blue',
            },
          ],
          isStarred: true,
          starredAt: '2026-09-28T00:00:00.000Z',
          createdAt: '2026-09-28T00:00:00.000Z',
          updatedAt: '2026-09-28T00:00:00.000Z',
        },
      ])
    )
    vi.stubGlobal('fetch', fetch)

    const projects = await listProjects(workspaceId)
    expect(projects[0]).toMatchObject({
      workspaceId,
      orgId: workspaceId,
      categories: ['Specs'],
      categoryColors: { Specs: 'blue' },
      documentIds: [],
    })
    expect(
      new Headers(fetch.mock.calls[0][1].headers).get('X-Workspace-Id')
    ).toBe(workspaceId)
  })

  it('creates a document through the API and surfaces backend errors', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          id: documentId,
          workspaceId,
          title: 'New spec',
          type: 'dbdiagram',
          content: 'Table users { id int }',
          authorId: testSession().user.id,
          author: {
            id: testSession().user.id,
            name: 'Test User',
            email: 'user@example.com',
            avatar: '',
          },
          tags: [],
          isDraft: false,
          visibility: 'workspace',
          isStarred: false,
          isShared: false,
          categories: [],
          createdAt: '2026-09-28T00:00:00.000Z',
          updatedAt: '2026-09-28T00:00:00.000Z',
        },
        201
      )
    )
    vi.stubGlobal('fetch', fetch)

    const doc = await createDocument(
      workspaceId,
      {
        title: 'New spec',
        type: 'dbdiagram',
        content: 'Table users { id int }',
      },
      requestID
    )
    const [, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toMatchObject({
      title: 'New spec',
      content: 'Table users { id int }',
    })
    expect(new Headers(init.headers).get('X-Workspace-Id')).toBe(workspaceId)
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe(requestID)
    expect(doc.id).toBe(documentId)

    fetch.mockResolvedValueOnce(jsonResponse({ title: 'Bad request' }, 422))
    await expect(
      createDocument(workspaceId, { title: 'x', type: 'dbdiagram' }, requestID)
    ).rejects.toThrow('Bad request')
  })

  it.each([401, 404, 500])(
    'preserves backend status %i as an API error',
    async (status) => {
      useAuthStore.getState().auth.setSession(testSession())
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(jsonResponse({ title: 'Backend error' }, status))
      )
      await expect(listDocuments(workspaceId)).rejects.toMatchObject({ status })
    }
  )
})
