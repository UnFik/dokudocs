import { beforeEach, describe, expect, it } from 'vitest'
import {
  type CommentAuthor,
  getDecorationsForBlock,
  useCommentStore,
} from './comment-store'

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

  it('isolates decorations to the matching blockId and respects exact offsets', () => {
    const docId = 'doc-iso-test'
    useCommentStore.getState().addThread({
      docId,
      selectedText: 'target',
      content: 'Comment on block 2',
      author: mockAuthor,
      blockId: 'blk-2',
      from: 14,
      to: 20,
    })

    const block1Decs = getDecorationsForBlock(
      docId,
      'blk-1',
      'This has target word here.',
      null
    )
    expect(block1Decs).toHaveLength(0)

    const block2Decs = getDecorationsForBlock(
      docId,
      'blk-2',
      'Another line, target word here.',
      null
    )
    expect(block2Decs).toHaveLength(1)
    expect(block2Decs[0].start).toBe(14)
    expect(block2Decs[0].end).toBe(20)
    expect(block2Decs[0].className).toBe('doc-comment-highlight')
  })

  it('matches decorations across unassigned blockId using fallback text matching after reload', () => {
    const docId = 'doc-reload-test'
    useCommentStore.getState().addThread({
      docId,
      selectedText: 'reloaded sentence',
      content: 'Persistent comment',
      author: mockAuthor,
      from: 5,
      to: 22,
    })

    const newBlockDecs = getDecorationsForBlock(
      docId,
      'newly-generated-block-id',
      'This reloaded sentence is preserved.',
      null
    )
    expect(newBlockDecs).toHaveLength(1)
    expect(newBlockDecs[0].start).toBe(5)
    expect(newBlockDecs[0].end).toBe(22)
    expect(newBlockDecs[0].className).toBe('doc-comment-highlight')
  })

  it('handles sidebar open state and active thread state', () => {
    expect(useCommentStore.getState().isSidebarOpen).toBe(false)
    useCommentStore.getState().setSidebarOpen(true)
    expect(useCommentStore.getState().isSidebarOpen).toBe(true)

    useCommentStore.getState().toggleSidebar()
    expect(useCommentStore.getState().isSidebarOpen).toBe(false)

    useCommentStore.getState().setActiveThreadId('test-thread-id')
    expect(useCommentStore.getState().activeThreadId).toBe('test-thread-id')
  })
})



