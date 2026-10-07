import { markdownToDocumentBody } from './muya/state/markdownToDocumentBody'
import { documentBodyToProseMirror } from './prosemirror/documentBody'

/** The editor's document, as JSON, for Markdown text: what a new document is created with. */
export async function markdownToDocumentJSON(
  markdown: string
): Promise<unknown> {
  const { nodes } = await markdownToDocumentBody(
    crypto.randomUUID(),
    markdown,
    1,
    {
      lenient: true,
    }
  )
  return documentBodyToProseMirror(nodes).toJSON()
}
