import { ApiError } from '@/lib/api-client'
import { getMarkdownBody, listDocuments } from '@/lib/domain-api'
import { initializeMarkdownBodyFromSource } from './initialize-markdown-body'

export interface MarkdownBackfillProgress {
  completed: number
  total: number
  title: string
}

export interface MarkdownBackfillResult {
  total: number
  initialized: number
  alreadyInitialized: number
  failed: { id: string; title: string; reason: string }[]
}

export async function backfillMarkdownBodies(
  workspaceID: string,
  onProgress: (progress: MarkdownBackfillProgress) => void
): Promise<MarkdownBackfillResult> {
  const documents = (await listDocuments(workspaceID)).filter(
    (document) => document.type === 'markdown' && !document.deletedAt
  )
  const result: MarkdownBackfillResult = {
    total: documents.length,
    initialized: 0,
    alreadyInitialized: 0,
    failed: [],
  }

  for (const [index, document] of documents.entries()) {
    const report = () =>
      onProgress({
        completed: index + 1,
        total: documents.length,
        title: document.title,
      })

    try {
      await getMarkdownBody(workspaceID, document.id)
      result.alreadyInitialized++
      report()
      continue
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        error.status !== 409 ||
        error.title !== 'document body is not initialized'
      ) {
        result.failed.push({
          id: document.id,
          title: document.title,
          reason: error instanceof ApiError ? error.title : String(error),
        })
        report()
        continue
      }
    }

    try {
      await initializeMarkdownBodyFromSource({
        workspaceID,
        documentID: document.id,
        markdown: document.content,
      })
      result.initialized++
    } catch (error) {
      result.failed.push({
        id: document.id,
        title: document.title,
        reason: error instanceof ApiError ? error.title : String(error),
      })
    }
    report()
  }

  return result
}
