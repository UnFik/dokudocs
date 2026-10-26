import { createContext, useContext, useEffect, useRef } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import type { RAGConversation } from '@/lib/domain-api'
import type { Attachment } from './question-extras'

/**
 * Where the page's fixed corner buttons step aside for the open column: its width
 * (set on the element as `--chat-column-width`) and 1rem of room.
 */
export const CHAT_COLUMN_OFFSET = 'sm:right-[calc(var(--chat-column-width)_+_1rem)]'

export interface ChatPanelState {
  documentID: string
  workspaceID: string
  title: string
  open: boolean
  setOpen: (open: boolean) => void
  /** Width of the column in pixels; `commit` is false while the edge is still being dragged. */
  columnWidth: number
  setColumnWidth: (width: number, commit: boolean) => void
  unread: number
  conversations: UseQueryResult<RAGConversation[]>
  listKey: unknown[]
  onRunning: (conversationID: string | undefined) => void
  /** The files held for the next question, kept while the column is shut. */
  draft: {
    attachments: Attachment[]
    onChange: (attachments: Attachment[]) => void
    focusRequest: number
    /** A question put in the box by the page (Fix with AI); a new `id` replaces what is typed. */
    prefill: { text: string; id: number }
  }
  /**
   * Adds text taken from the page to the next question, opens the column and
   * puts the caret in the question box. Returns why it could not, if it could not.
   */
  addToChat: (selection: Attachment) => string | undefined
  /** Opens the column and puts the caret in the question box. */
  openChat: () => void
}

export const ChatPanelContext = createContext<ChatPanelState | null>(null)

/** The chat's state, or nothing on a page that has no chat (offline). */
export function useDocumentChatPanel() {
  return useContext(ChatPanelContext)
}

/**
 * Keeps the chat column and a panel of the editor's own (comments) from being
 * open together: opening either shuts the other.
 */
export function useChatPanelSibling(open: boolean, close: () => void) {
  const chat = useDocumentChatPanel()
  const chatOpen = chat?.open ?? false
  const latest = useRef({ open, close, chat })
  useEffect(() => {
    latest.current = { open, close, chat }
  })
  useEffect(() => {
    if (chatOpen && latest.current.open) latest.current.close()
    // Runs when the chat opens only; the other effect handles the sibling opening.
  }, [chatOpen])
  useEffect(() => {
    if (open && latest.current.chat?.open) latest.current.chat.setOpen(false)
  }, [open])
}
