import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export interface CommentAuthor {
  id: string
  name: string
  email: string
  avatar?: string
}

export interface CommentReply {
  id: string
  author: CommentAuthor
  content: string
  createdAt: string
  updatedAt: string
}

export interface CommentThread {
  id: string
  docId: string
  selectedText: string
  blockId?: string
  from?: number
  to?: number
  blockPath?: (string | number)[]
  sectionTitle?: string
  author: CommentAuthor
  content: string
  createdAt: string
  updatedAt: string
  isResolved: boolean
  resolvedAt?: string | null
  resolvedBy?: CommentAuthor | null
  replies: CommentReply[]
}

interface CommentState {
  threads: CommentThread[]
  activeThreadId: string | null
  isSidebarOpen: boolean

  setSidebarOpen: (isOpen: boolean) => void
  toggleSidebar: () => void
  setActiveThreadId: (id: string | null) => void

  getDocThreads: (docId: string) => CommentThread[]
  getDocUnresolvedCount: (docId: string) => number

  addThread: (payload: {
    docId: string
    selectedText: string
    content: string
    author: CommentAuthor
    blockId?: string
    from?: number
    to?: number
    blockPath?: (string | number)[]
    sectionTitle?: string
  }) => CommentThread

  addReply: (
    threadId: string,
    content: string,
    author: CommentAuthor
  ) => CommentReply | null

  editComment: (
    threadId: string,
    replyId: string | null,
    content: string
  ) => void

  deleteThread: (
    threadId: string,
    onApply?: (transformContent: (content: string) => string) => void
  ) => void
  deleteReply: (threadId: string, replyId: string) => void

  toggleResolveThread: (
    threadId: string,
    author?: CommentAuthor,
    onApply?: (transformContent: (content: string) => string) => void
  ) => void
}

function generateId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function getDecorationsForBlock(
  docId: string,
  blockId: string,
  blockText: string,
  activeThreadId: string | null,
  blockPath?: (string | number)[],
  _blockOffset?: { start: number; end: number }
): Array<{
  start: number
  end: number
  active?: boolean
  className?: string
  dataset?: Record<string, string>
}> {
  const threads = useCommentStore.getState().threads || []
  const docThreads = threads.filter((t) => t.docId === docId && !t.isResolved)
  const results: Array<{
    start: number
    end: number
    active?: boolean
    className?: string
    dataset?: Record<string, string>
  }> = []

  for (const thread of docThreads) {
    if (thread.blockId && thread.blockId !== blockId) {
      continue
    }

    if (
      thread.blockPath &&
      thread.blockPath.length > 0 &&
      blockPath &&
      blockPath.length > 0
    ) {
      const match =
        thread.blockPath.length === blockPath.length &&
        thread.blockPath.every((val, idx) => val === blockPath[idx])
      if (!match) {
        continue
      }
    }

    const isActive = thread.id === activeThreadId

    if (thread.selectedText) {
      let foundStart = -1
      let foundEnd = -1

      if (
        thread.from !== undefined &&
        thread.to !== undefined &&
        thread.blockId === blockId &&
        thread.from >= 0 &&
        thread.to <= blockText.length &&
        blockText.substring(thread.from, thread.to) === thread.selectedText
      ) {
        foundStart = thread.from
        foundEnd = thread.to
      } else if (blockText.includes(thread.selectedText)) {
        foundStart = blockText.indexOf(thread.selectedText)
        foundEnd = foundStart + thread.selectedText.length
      }

      if (foundStart !== -1) {
        results.push({
          start: foundStart,
          end: foundEnd,
          active: isActive,
          className: isActive
            ? 'doc-comment-highlight is-active'
            : 'doc-comment-highlight',
          dataset: { threadId: thread.id },
        })
      }
    }
  }

  return results
}

export const useCommentStore = create<CommentState>()(
  persist(
    (set, get) => ({
      threads: [],
      activeThreadId: null,
      isSidebarOpen: false,

      setSidebarOpen: (isOpen) => set({ isSidebarOpen: isOpen }),
      toggleSidebar: () =>
        set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
      setActiveThreadId: (id) => set({ activeThreadId: id }),

      getDocThreads: (docId) => {
        return (get().threads || []).filter((t) => t.docId === docId)
      },

      getDocUnresolvedCount: (docId) => {
        return (get().threads || []).filter(
          (t) => t.docId === docId && !t.isResolved
        ).length
      },

      addThread: ({
        docId,
        selectedText,
        content,
        author,
        blockId,
        from,
        to,
        blockPath,
        sectionTitle,
      }) => {
        const now = new Date().toISOString()

        const newThread: CommentThread = {
          id: generateId('thread'),
          docId,
          selectedText: selectedText.trim(),
          blockId,
          from,
          to,
          blockPath,
          sectionTitle,
          author,
          content: content.trim(),
          createdAt: now,
          updatedAt: now,
          isResolved: false,
          replies: [],
        }

        set((state) => ({
          threads: [newThread, ...(state.threads || [])],
          activeThreadId: newThread.id,
        }))

        return newThread
      },

      addReply: (threadId, content, author) => {
        const now = new Date().toISOString()
        const newReply: CommentReply = {
          id: generateId('reply'),
          author,
          content: content.trim(),
          createdAt: now,
          updatedAt: now,
        }

        let updated = false
        set((state) => ({
          threads: (state.threads || []).map((t) => {
            if (t.id !== threadId) return t
            updated = true
            return {
              ...t,
              updatedAt: now,
              replies: [...(t.replies || []), newReply],
            }
          }),
        }))

        return updated ? newReply : null
      },

      editComment: (threadId, replyId, content) => {
        const now = new Date().toISOString()
        set((state) => ({
          threads: (state.threads || []).map((t) => {
            if (t.id !== threadId) return t
            if (!replyId) {
              return {
                ...t,
                content: content.trim(),
                updatedAt: now,
              }
            }
            return {
              ...t,
              replies: (t.replies || []).map((r) =>
                r.id === replyId
                  ? { ...r, content: content.trim(), updatedAt: now }
                  : r
              ),
            }
          }),
        }))
      },

      deleteThread: (threadId, onApply) => {
        if (onApply) {
          onApply((content: string) => {
            if (content.includes(`data-thread-id="${threadId}"`)) {
              const markRegex = new RegExp(
                `<mark\\b[^>]*\\bdata-thread-id=["']${threadId}["'][^>]*>([\\s\\S]*?)<\\/mark>`,
                'gi'
              )
              return content.replace(markRegex, '$1')
            }
            return content
          })
        }
        set((state) => ({
          threads: (state.threads || []).filter((t) => t.id !== threadId),
          activeThreadId:
            state.activeThreadId === threadId ? null : state.activeThreadId,
        }))
      },
      deleteReply: (threadId, replyId) => {
        set((state) => ({
          threads: (state.threads || []).map((t) => {
            if (t.id !== threadId) return t
            return {
              ...t,
              replies: (t.replies || []).filter((r) => r.id !== replyId),
            }
          }),
        }))
      },

      toggleResolveThread: (threadId, author, onApply) => {
        const targetThread = (get().threads || []).find(
          (t) => t.id === threadId
        )
        const nextResolved = targetThread ? !targetThread.isResolved : false

        if (onApply && nextResolved) {
          onApply((content: string) => {
            if (content.includes(`data-thread-id="${threadId}"`)) {
              const markRegex = new RegExp(
                `<mark\\b[^>]*\\bdata-thread-id=["']${threadId}["'][^>]*>([\\s\\S]*?)<\\/mark>`,
                'gi'
              )
              return content.replace(markRegex, '$1')
            }
            return content
          })
        }

        const now = new Date().toISOString()
        set((state) => ({
          threads: (state.threads || []).map((t) => {
            if (t.id !== threadId) return t
            return {
              ...t,
              isResolved: nextResolved,
              resolvedAt: nextResolved ? now : null,
              resolvedBy: nextResolved ? (author ?? null) : null,
            }
          }),
        }))
      },
    }),
    {
      name: 'dokudocs-comments-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
)

