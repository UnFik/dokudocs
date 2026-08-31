import { beforeEach, describe, expect, it } from 'vitest'
import { useCommentStore, parseSuggestionsFromMarkdown } from './comment-store'
import type { CommentAuthor } from './comment-store'

const mockAuthor: CommentAuthor = {
  id: 'usr-1',
  name: 'Fikri',
  email: 'fikri@dokudocs.app',
  avatar: '/avatars/01.png',
}

describe('useCommentStore', () => {
  beforeEach(() => {
    useCommentStore.setState({
      threads: [],
      activeThreadId: null,
      isSidebarOpen: false,
    })
  })

  it('adds a new comment thread and sets it active', () => {
    const thread = useCommentStore.getState().addThread({
      docId: 'doc-123',
      selectedText: 'selected snippet',
      content: 'This is a comment',
      author: mockAuthor,
    })

    expect(thread.id).toBeDefined()
    expect(thread.docId).toBe('doc-123')
    expect(thread.selectedText).toBe('selected snippet')
    expect(thread.content).toBe('This is a comment')
    expect(thread.isResolved).toBe(false)

    const state = useCommentStore.getState()
    expect(state.threads).toHaveLength(1)
    expect(state.activeThreadId).toBe(thread.id)
    expect(state.getDocUnresolvedCount('doc-123')).toBe(1)
  })

  it('adds a reply to an existing thread', () => {
    const thread = useCommentStore.getState().addThread({
      docId: 'doc-123',
      selectedText: 'snippet',
      content: 'Root comment',
      author: mockAuthor,
    })

    const reply = useCommentStore
      .getState()
      .addReply(thread.id, 'This is a reply', mockAuthor)

    expect(reply).not.toBeNull()
    expect(reply?.content).toBe('This is a reply')

    const updatedThread = useCommentStore
      .getState()
      .threads.find((t) => t.id === thread.id)
    expect(updatedThread?.replies).toHaveLength(1)
    expect(updatedThread?.replies[0].content).toBe('This is a reply')
  })

  it('edits root comment and replies', () => {
    const thread = useCommentStore.getState().addThread({
      docId: 'doc-123',
      selectedText: 'snippet',
      content: 'Original comment',
      author: mockAuthor,
    })

    const reply = useCommentStore
      .getState()
      .addReply(thread.id, 'Original reply', mockAuthor)

    useCommentStore.getState().editComment(thread.id, null, 'Updated comment')
    let currentThread = useCommentStore
      .getState()
      .threads.find((t) => t.id === thread.id)
    expect(currentThread?.content).toBe('Updated comment')

    if (reply) {
      useCommentStore
        .getState()
        .editComment(thread.id, reply.id, 'Updated reply')
      currentThread = useCommentStore
        .getState()
        .threads.find((t) => t.id === thread.id)
      expect(currentThread?.replies[0].content).toBe('Updated reply')
    }
  })

  it('deletes replies and threads', () => {
    const thread = useCommentStore.getState().addThread({
      docId: 'doc-123',
      selectedText: 'snippet',
      content: 'Comment to delete',
      author: mockAuthor,
    })

    const reply = useCommentStore
      .getState()
      .addReply(thread.id, 'Reply to delete', mockAuthor)

    if (reply) {
      useCommentStore.getState().deleteReply(thread.id, reply.id)
      const currentThread = useCommentStore
        .getState()
        .threads.find((t) => t.id === thread.id)
      expect(currentThread?.replies).toHaveLength(0)
    }

    useCommentStore.getState().deleteThread(thread.id)
    expect(useCommentStore.getState().threads).toHaveLength(0)
    expect(useCommentStore.getState().activeThreadId).toBeNull()
  })

  it('toggles thread resolution', () => {
    const thread = useCommentStore.getState().addThread({
      docId: 'doc-123',
      selectedText: 'snippet',
      content: 'Comment',
      author: mockAuthor,
    })

    expect(useCommentStore.getState().getDocUnresolvedCount('doc-123')).toBe(1)

    useCommentStore.getState().toggleResolveThread(thread.id, mockAuthor)
    let currentThread = useCommentStore
      .getState()
      .threads.find((t) => t.id === thread.id)
    expect(currentThread?.isResolved).toBe(true)
    expect(useCommentStore.getState().getDocUnresolvedCount('doc-123')).toBe(0)

    useCommentStore.getState().toggleResolveThread(thread.id, mockAuthor)
    currentThread = useCommentStore
      .getState()
      .threads.find((t) => t.id === thread.id)
    expect(currentThread?.isResolved).toBe(false)
    expect(useCommentStore.getState().getDocUnresolvedCount('doc-123')).toBe(1)
  })

  it('parses suggestions from markdown correctly for Delete, Add, and Replace', () => {
    const markdown = `
      Some text with <del data-suggestion-id="sug-1">valid</del> deleted,
      and <ins data-suggestion-id="sug-2">ation</ins> added,
      and <del data-suggestion-id="sug-3">validation</del><ins data-suggestion-id="sug-3">invalid</ins> replaced.
    `
    const parsed = parseSuggestionsFromMarkdown(markdown)
    expect(parsed).toHaveLength(3)

    const delSug = parsed.find((p) => p.id === 'sug-1')
    expect(delSug).toBeDefined()
    expect(delSug?.type).toBe('delete')
    expect(delSug?.originalText).toBe('valid')
    expect(delSug?.suggestedText).toBe('')

    const addSug = parsed.find((p) => p.id === 'sug-2')
    expect(addSug).toBeDefined()
    expect(addSug?.type).toBe('add')
    expect(addSug?.originalText).toBe('')
    expect(addSug?.suggestedText).toBe('ation')

    const replaceSug = parsed.find((p) => p.id === 'sug-3')
    expect(replaceSug).toBeDefined()
    expect(replaceSug?.type).toBe('replace')
    expect(replaceSug?.originalText).toBe('validation')
    expect(replaceSug?.suggestedText).toBe('invalid')
  })

  it('syncs document suggestions and automatically appends and unappends threads', () => {
    const docId = 'doc-123'
    const md1 = 'Hello <del data-suggestion-id="sug-del">valid</del> world'
    useCommentStore.getState().syncDocumentSuggestions(docId, md1, mockAuthor)

    let threads = useCommentStore.getState().getDocThreads(docId)
    expect(threads).toHaveLength(1)
    expect(threads[0].content).toBe('Delete: “valid”')
    expect(threads[0].suggestion?.type).toBe('delete')

    const md2 = 'Hello <del data-suggestion-id="sug-del">valid</del> <ins data-suggestion-id="sug-add">ation</ins> world'
    useCommentStore.getState().syncDocumentSuggestions(docId, md2, mockAuthor)
    threads = useCommentStore.getState().getDocThreads(docId)
    expect(threads).toHaveLength(2)

    const mdUndo = 'Hello world'
    useCommentStore.getState().syncDocumentSuggestions(docId, mdUndo, mockAuthor)
    threads = useCommentStore.getState().getDocThreads(docId)
    expect(threads).toHaveLength(0)

    useCommentStore.getState().syncDocumentSuggestions(docId, md2, mockAuthor)
    threads = useCommentStore.getState().getDocThreads(docId)
    expect(threads).toHaveLength(2)
  })

  it('accepts and rejects suggestions by transforming document markdown', () => {
    const docId = 'doc-123'
    const md = 'Value is <del data-suggestion-id="sug-rep">validation</del><ins data-suggestion-id="sug-rep">invalid</ins> here.'
    useCommentStore.getState().syncDocumentSuggestions(docId, md, mockAuthor)

    const thread = useCommentStore.getState().getDocThreads(docId)[0]
    expect(thread).toBeDefined()
    expect(thread.content).toBe('Replace: “validation” with “invalid”')

    let updatedDoc = md
    useCommentStore.getState().acceptSuggestion(thread.id, (transform) => {
      updatedDoc = transform(updatedDoc)
    })

    expect(updatedDoc).toBe('Value is invalid here.')
    let currentThread = useCommentStore.getState().threads.find((t) => t.id === thread.id)
    expect(currentThread?.isResolved).toBe(true)
    expect(currentThread?.suggestion?.status).toBe('accepted')

    const mdDel = 'Value is <del data-suggestion-id="sug-d">valid</del> done.'
    useCommentStore.getState().syncDocumentSuggestions(docId, mdDel, mockAuthor)
    const delThread = useCommentStore.getState().getDocThreads(docId).find((t) => t.suggestion?.id === 'sug-d')!
    expect(delThread).toBeDefined()

    let docAfterReject = mdDel
    useCommentStore.getState().rejectSuggestion(delThread.id, (transform) => {
      docAfterReject = transform(docAfterReject)
    })

    expect(docAfterReject).toBe('Value is valid done.')
    const rejectedThread = useCommentStore.getState().threads.find((t) => t.id === delThread.id)
    expect(rejectedThread?.isResolved).toBe(true)
    expect(rejectedThread?.suggestion?.status).toBe('rejected')
  })
})
