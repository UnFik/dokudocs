import { ThemeToggleButton } from '@/components/theme-toggle-button'
import { DocumentChatPanel } from '@/features/rag/document-chat-panel'

/**
 * The buttons that float at the bottom right of every document, whatever its
 * type: the theme switch on top and Ask AI at the very bottom. A document
 * without a chat (offline) shows the theme switch alone.
 */
export function DocumentFloatingControls({
  chat,
}: {
  chat?: { documentID: string; workspaceID: string; title: string }
}) {
  return (
    <div className='fixed right-4 bottom-4 z-40 flex flex-col items-end gap-2'>
      <ThemeToggleButton className='bg-background' />
      {chat ? <DocumentChatPanel {...chat} /> : null}
    </div>
  )
}
