export type ExportFormat = 'md' | 'pdf' | 'docx'

const MAX_NAME_LENGTH = 120

/** The file a document exports to: its title, with what a file system refuses replaced. */
export function exportFileName(title: string, extension: ExportFormat): string {
  const name = Array.from(
    title
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[\\/:*?"<>|]/g, '-')
      .trim()
      .replace(/^\.+/, '')
  )
    .slice(0, MAX_NAME_LENGTH)
    .join('')
    .replace(/[. ]+$/, '')
  return `${name || 'Untitled'}.${extension}`
}

/** Offers `blob` to the browser as a download called `name`. */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Downloads the document's Markdown as a `.md` file and returns the file's name. */
export function exportMarkdown(markdown: string, title: string): string {
  const name = exportFileName(title, 'md')
  downloadBlob(
    new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
    name
  )
  return name
}

/** What an export needs: the document, and its Markdown as the editor holds it now. */
export type ExportContext = {
  documentID: string
  workspaceID: string
  title: string
  markdown: string
}

/** Exports the document in `format` and returns the name of the file it saved. */
export async function exportDocument(
  format: ExportFormat,
  context: ExportContext
): Promise<string> {
  if (format === 'md') return exportMarkdown(context.markdown, context.title)
  if (format === 'pdf') {
    const { exportPdf } = await import('./export-pdf')
    return exportPdf(context)
  }
  const { exportDocx } = await import('./export-docx')
  return exportDocx(context)
}
