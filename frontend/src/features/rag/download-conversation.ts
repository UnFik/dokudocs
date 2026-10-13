import { conversationMarkdown } from './conversation-format'

type Messages = Parameters<typeof conversationMarkdown>[1]

const filenameOf = (title: string) =>
  `${
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'chat'
  }.md`

/** Saves a chat as a Markdown file through the browser's download. */
export function downloadConversation(title: string, messages: Messages) {
  const url = URL.createObjectURL(
    new Blob([conversationMarkdown(title, messages)], {
      type: 'text/markdown',
    })
  )
  const link = document.createElement('a')
  link.href = url
  link.download = filenameOf(title)
  link.click()
  URL.revokeObjectURL(url)
}
