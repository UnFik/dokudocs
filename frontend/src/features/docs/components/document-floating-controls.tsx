import { ThemeToggleButton } from '@/components/theme-toggle-button'
import {
  CHAT_COLUMN_OFFSET,
  useDocumentChatPanel,
} from '@/features/rag/chat-panel-context'

/**
 * The theme switch, fixed at the bottom right of every document, whatever its
 * type. Ask AI lives in the editor header. It steps left of the chat column
 * while that is open, so it never covers the question box.
 */
export function DocumentFloatingControls() {
  const chat = useDocumentChatPanel()
  return (
    <div
      className={`fixed right-4 bottom-4 z-40 flex flex-col items-end gap-2 ${chat?.open ? CHAT_COLUMN_OFFSET : ''}`}
    >
      <ThemeToggleButton className='bg-background' />
    </div>
  )
}
