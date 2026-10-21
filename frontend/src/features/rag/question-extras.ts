import type { EditorContext } from './editor-context'

export type Attachment = { name: string; text: string }

/** What one question carries besides its text; the server checks every part again. */
export type QuestionExtras = {
  categoryIds: string[]
  contextChatIds: string[]
  attachments: Attachment[]
  /** What the open DBML or Mermaid editor shows; only a document chat has it. */
  editorContext?: EditorContext
}

export const noExtras: QuestionExtras = {
  categoryIds: [],
  contextChatIds: [],
  attachments: [],
}

export const MAX_CATEGORIES = 5
export const MAX_CONTEXT_CHATS = 2
export const MAX_FILES = 5
export const MAX_ATTACHMENT_CHARS = 200_000

const TEXT_FILE = /\.(txt|md|markdown|csv|tsv|json|log)$/i
export const FILE_ACCEPT = '.txt,.md,.markdown,.csv,.tsv,.json,.log'

/**
 * Reads files the User picked as text, on top of the ones already attached.
 * It stops at the first file it cannot take and says why; what was attached
 * before stays.
 */
export async function readAttachments(
  files: File[],
  existing: Attachment[]
): Promise<{ attachments: Attachment[]; error?: string }> {
  const attachments = [...existing]
  let total = attachments.reduce((sum, file) => sum + file.text.length, 0)
  for (const file of files) {
    if (attachments.some((have) => have.name === file.name)) continue
    if (attachments.length >= MAX_FILES)
      return {
        attachments,
        error: `Attach up to ${MAX_FILES} files to one question.`,
      }
    if (!TEXT_FILE.test(file.name))
      return {
        attachments,
        error: `${file.name} is not a text file. Attach .txt, .md, .csv, .tsv, .json or .log files.`,
      }
    const text = await file.text()
    if (!text.trim())
      return { attachments, error: `${file.name} has no text in it.` }
    total += text.length
    if (total > MAX_ATTACHMENT_CHARS)
      return {
        attachments,
        error: `${file.name} is too long. All the files together may hold up to ${MAX_ATTACHMENT_CHARS.toLocaleString('en-US')} characters.`,
      }
    attachments.push({ name: file.name, text })
  }
  return { attachments }
}
