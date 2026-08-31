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

export type SuggestionType = 'add' | 'delete' | 'replace'

export interface SuggestionData {
  id: string
  type: SuggestionType
  originalText: string
  suggestedText: string
  status: 'pending' | 'accepted' | 'rejected'
}

export interface CommentThread {
  id: string
  docId: string
  selectedText: string
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
  suggestion?: SuggestionData
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
    blockPath?: (string | number)[]
    sectionTitle?: string
    suggestion?: {
      id?: string
      type?: SuggestionType
      originalText?: string
      suggestedText?: string
    }
  }) => CommentThread

  syncDocumentSuggestions: (
    docId: string,
    markdownContent: string,
    author: CommentAuthor
  ) => void

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

  acceptSuggestion: (
    threadId: string,
    onApply: (transformContent: (content: string) => string) => void
  ) => void

  rejectSuggestion: (
    threadId: string,
    onApply: (transformContent: (content: string) => string) => void
  ) => void
}

function generateId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function findNearestHeadingBefore(
  markdown: string,
  index: number
): string | undefined {
  const beforeText = markdown.substring(0, index)
  const lines = beforeText.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    const match = line.match(/^#{1,6}\s+(.+)$/)
    if (match) {
      return match[1].replace(/\*\*/g, '').replace(/[*_`]/g, '').trim()
    }
  }
  return undefined
}

function formatSuggestionTitle(
  type: SuggestionType,
  originalText: string,
  suggestedText: string
) {
  if (type === 'delete') {
    return `Delete: “${originalText}”`
  }
  if (type === 'add') {
    return `Add: “${suggestedText}”`
  }
  return `Replace: “${originalText}” with “${suggestedText}”`
}

export function parseSuggestionsFromMarkdown(markdown: string): Array<{
  id: string
  type: SuggestionType
  originalText: string
  suggestedText: string
  sectionTitle?: string
}> {
  const map = new Map<
    string,
    {
      hasDel: boolean
      hasIns: boolean
      delText: string
      insText: string
      sectionTitle?: string
    }
  >()

  const delRegex =
    /<del\b[^>]*\bdata-suggestion-id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/del>/gi
  let match: RegExpExecArray | null
  while ((match = delRegex.exec(markdown)) !== null) {
    const id = match[1]
    const text = match[2]
    const existing = map.get(id) || {
      hasDel: false,
      hasIns: false,
      delText: '',
      insText: '',
      sectionTitle: findNearestHeadingBefore(markdown, match.index),
    }
    existing.hasDel = true
    existing.delText = text
    if (!existing.sectionTitle) {
      existing.sectionTitle = findNearestHeadingBefore(markdown, match.index)
    }
    map.set(id, existing)
  }

  const insRegex =
    /<ins\b[^>]*\bdata-suggestion-id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/ins>/gi
  while ((match = insRegex.exec(markdown)) !== null) {
    const id = match[1]
    const text = match[2]
    const existing = map.get(id) || {
      hasDel: false,
      hasIns: false,
      delText: '',
      insText: '',
      sectionTitle: findNearestHeadingBefore(markdown, match.index),
    }
    existing.hasIns = true
    existing.insText = text
    if (!existing.sectionTitle) {
      existing.sectionTitle = findNearestHeadingBefore(markdown, match.index)
    }
    map.set(id, existing)
  }

  const results: Array<{
    id: string
    type: SuggestionType
    originalText: string
    suggestedText: string
    sectionTitle?: string
  }> = []

  map.forEach((val, id) => {
    if (val.hasDel && val.hasIns) {
      results.push({
        id,
        type: 'replace',
        originalText: val.delText,
        suggestedText: val.insText,
        sectionTitle: val.sectionTitle,
      })
    } else if (val.hasDel) {
      results.push({
        id,
        type: 'delete',
        originalText: val.delText,
        suggestedText: '',
        sectionTitle: val.sectionTitle,
      })
    } else if (val.hasIns) {
      results.push({
        id,
        type: 'add',
        originalText: '',
        suggestedText: val.insText,
        sectionTitle: val.sectionTitle,
      })
    }
  })

  return results
}

export const useCommentStore = create<CommentState>()(
  persist(
    (set, get) => ({
      threads: [],
      activeThreadId: null,
      isSidebarOpen: false,

      setSidebarOpen: (isSidebarOpen) => set({ isSidebarOpen }),
      toggleSidebar: () =>
        set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
      setActiveThreadId: (activeThreadId) => set({ activeThreadId }),

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
        blockPath,
        suggestion,
      }) => {
        const now = new Date().toISOString()
        const sugId = suggestion?.id || generateId('sug')
        const sugType: SuggestionType =
          suggestion?.type ||
          (suggestion?.originalText && suggestion?.suggestedText
            ? 'replace'
            : suggestion?.originalText
            ? 'delete'
            : 'add')

        const newThread: CommentThread = {
          id: generateId('thread'),
          docId,
          selectedText,
          blockPath,
          author,
          content:
            suggestion
              ? formatSuggestionTitle(
                  sugType,
                  suggestion.originalText || '',
                  suggestion.suggestedText || ''
                )
              : content,
          createdAt: now,
          updatedAt: now,
          isResolved: false,
          replies: [],
          suggestion: suggestion
            ? {
                id: sugId,
                type: sugType,
                originalText: suggestion.originalText || '',
                suggestedText: suggestion.suggestedText || '',
                status: 'pending',
              }
            : undefined,
        }

        set((state) => ({
          threads: [newThread, ...(state.threads || [])],
          activeThreadId: newThread.id,
        }))

        return newThread
      },

      syncDocumentSuggestions: (docId, markdownContent, author) => {
        const parsed = parseSuggestionsFromMarkdown(markdownContent)
        const parsedMap = new Map(parsed.map((p) => [p.id, p]))
        const now = new Date().toISOString()

        const currentThreads = get().threads || []
        const docThreads = currentThreads.filter((t) => t.docId === docId)
        const otherDocThreads = currentThreads.filter((t) => t.docId !== docId)

        const existingSugIds = new Set<string>()
        let changed = false

        const updatedDocThreads: CommentThread[] = []

        for (const thread of docThreads) {
          if (!thread.suggestion) {
            updatedDocThreads.push(thread)
            continue
          }

          if (thread.isResolved) {
            updatedDocThreads.push(thread)
            continue
          }

          const sugId = thread.suggestion.id
          existingSugIds.add(sugId)

          if (!parsedMap.has(sugId)) {
            changed = true
            continue
          }

          const fresh = parsedMap.get(sugId)!
          if (
            thread.suggestion.type !== fresh.type ||
            thread.suggestion.originalText !== fresh.originalText ||
            thread.suggestion.suggestedText !== fresh.suggestedText ||
            thread.sectionTitle !== fresh.sectionTitle
          ) {
            changed = true
            updatedDocThreads.push({
              ...thread,
              selectedText: fresh.originalText || fresh.suggestedText,
              sectionTitle: fresh.sectionTitle,
              content: formatSuggestionTitle(
                fresh.type,
                fresh.originalText,
                fresh.suggestedText
              ),
              updatedAt: now,
              suggestion: {
                ...thread.suggestion,
                type: fresh.type,
                originalText: fresh.originalText,
                suggestedText: fresh.suggestedText,
              },
            })
          } else {
            updatedDocThreads.push(thread)
          }
        }

        for (const fresh of parsed) {
          if (!existingSugIds.has(fresh.id)) {
            changed = true
            const newThread: CommentThread = {
              id: generateId('thread'),
              docId,
              selectedText: fresh.originalText || fresh.suggestedText,
              sectionTitle: fresh.sectionTitle,
              author,
              content: formatSuggestionTitle(
                fresh.type,
                fresh.originalText,
                fresh.suggestedText
              ),
              createdAt: now,
              updatedAt: now,
              isResolved: false,
              replies: [],
              suggestion: {
                id: fresh.id,
                type: fresh.type,
                originalText: fresh.originalText,
                suggestedText: fresh.suggestedText,
                status: 'pending',
              },
            }
            updatedDocThreads.unshift(newThread)
          }
        }

        if (changed) {
          set({
            threads: [...updatedDocThreads, ...otherDocThreads],
          })
        }
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
            const markRegex = new RegExp(
              `<mark\\b[^>]*\\bdata-thread-id=["']${threadId}["'][^>]*>([\\s\\S]*?)<\\/mark>`,
              'gi'
            )
            return content.replace(markRegex, '$1')
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
        const targetThread = (get().threads || []).find((t) => t.id === threadId)
        const nextResolved = targetThread ? !targetThread.isResolved : false

        if (onApply && nextResolved && !targetThread?.suggestion) {
          onApply((content: string) => {
            const markRegex = new RegExp(
              `<mark\\b[^>]*\\bdata-thread-id=["']${threadId}["'][^>]*>([\\s\\S]*?)<\\/mark>`,
              'gi'
            )
            return content.replace(markRegex, '$1')
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
              resolvedBy: nextResolved ? author ?? null : null,
            }
          }),
        }))
      },

      acceptSuggestion: (threadId, onApply) => {
        const thread = (get().threads || []).find((t) => t.id === threadId)
        if (
          !thread ||
          !thread.suggestion ||
          thread.suggestion.status !== 'pending'
        )
          return

        const sugId = thread.suggestion.id

        onApply((content: string) => {
          const replaceRegex = new RegExp(
            `<del\\b[^>]*\\bdata-suggestion-id=["']${sugId}["'][^>]*>[\\s\\S]*?<\\/del>\\s*<ins\\b[^>]*\\bdata-suggestion-id=["']${sugId}["'][^>]*>([\\s\\S]*?)<\\/ins>`,
            'gi'
          )
          let updated = content.replace(replaceRegex, '$1')

          const delRegex = new RegExp(
            `<del\\b[^>]*\\bdata-suggestion-id=["']${sugId}["'][^>]*>[\\s\\S]*?<\\/del>`,
            'gi'
          )
          updated = updated.replace(delRegex, '')

          const insRegex = new RegExp(
            `<ins\\b[^>]*\\bdata-suggestion-id=["']${sugId}["'][^>]*>([\\s\\S]*?)<\\/ins>`,
            'gi'
          )
          updated = updated.replace(insRegex, '$1')

          return updated
        })

        const now = new Date().toISOString()
        set((state) => ({
          threads: (state.threads || []).map((t) => {
            if (t.id !== threadId) return t
            return {
              ...t,
              isResolved: true,
              resolvedAt: now,
              suggestion: t.suggestion
                ? {
                    ...t.suggestion,
                    status: 'accepted',
                  }
                : undefined,
            }
          }),
        }))
      },

      rejectSuggestion: (threadId, onApply) => {
        const thread = (get().threads || []).find((t) => t.id === threadId)
        if (
          !thread ||
          !thread.suggestion ||
          thread.suggestion.status !== 'pending'
        )
          return

        const sugId = thread.suggestion.id

        onApply((content: string) => {
          const replaceRegex = new RegExp(
            `<del\\b[^>]*\\bdata-suggestion-id=["']${sugId}["'][^>]*>([\\s\\S]*?)<\\/del>\\s*<ins\\b[^>]*\\bdata-suggestion-id=["']${sugId}["'][^>]*>[\\s\\S]*?<\\/ins>`,
            'gi'
          )
          let updated = content.replace(replaceRegex, '$1')

          const delRegex = new RegExp(
            `<del\\b[^>]*\\bdata-suggestion-id=["']${sugId}["'][^>]*>([\\s\\S]*?)<\\/del>`,
            'gi'
          )
          updated = updated.replace(delRegex, '$1')

          const insRegex = new RegExp(
            `<ins\\b[^>]*\\bdata-suggestion-id=["']${sugId}["'][^>]*>[\\s\\S]*?<\\/ins>`,
            'gi'
          )
          updated = updated.replace(insRegex, '')

          return updated
        })

        const now = new Date().toISOString()
        set((state) => ({
          threads: (state.threads || []).map((t) => {
            if (t.id !== threadId) return t
            return {
              ...t,
              isResolved: true,
              resolvedAt: now,
              suggestion: t.suggestion
                ? {
                    ...t.suggestion,
                    status: 'rejected',
                  }
                : undefined,
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
