import { apiBlob } from '@/lib/api-client'
import { workspaceHeaders } from '@/lib/domain-api'
import {
  downloadBlob,
  exportFileName,
  type ExportContext,
} from './export-document'
import { buildExportHtml } from './export-html'

/** Prints the document to PDF on the server and saves the file; returns its name. */
export async function exportPdf(context: ExportContext): Promise<string> {
  const html = await buildExportHtml(context.markdown, {
    workspaceID: context.workspaceID,
  })
  const pdf = await apiBlob(
    `/api/v1/documents/${encodeURIComponent(context.documentID)}/export/pdf`,
    {
      method: 'POST',
      headers: {
        ...workspaceHeaders(context.workspaceID),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: context.title, html }),
    }
  ).catch((failure: unknown) => {
    // fetch fails with a TypeError when the server cannot be reached at all.
    if (failure instanceof TypeError)
      throw new Error('PDF export needs a connection')
    throw failure
  })
  const name = exportFileName(context.title, 'pdf')
  downloadBlob(pdf, name)
  return name
}
