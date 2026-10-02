import { ApiError } from '@/lib/api-client'
import { getMarkdownBody, initializeMarkdownBody } from '@/lib/domain-api'
import { markdownToDocumentBody } from './muya/state/markdownToDocumentBody'

export async function initializeMarkdownBodyFromSource(input: {
  workspaceID: string
  documentID: string
  markdown: string
  baseBodyVersion?: number
  bodySchemaVersion?: number
}) {
  const body = await markdownToDocumentBody(
    input.documentID,
    input.markdown,
    input.bodySchemaVersion
  )
  await initializeMarkdownBody(input.workspaceID, input.documentID, {
    ...body,
    baseBodyVersion: input.baseBodyVersion ?? 1,
  })
  return body
}

export async function getOrInitializeMarkdownBodyFromSource(input: {
  workspaceID: string
  documentID: string
  markdown: string
  baseBodyVersion?: number
  bodySchemaVersion?: number
}) {
  try {
    return await getMarkdownBody(input.workspaceID, input.documentID)
  } catch (error) {
    if (
      !(error instanceof ApiError) ||
      error.status !== 409 ||
      error.title !== 'document body is not initialized'
    )
      throw error
  }

  await initializeMarkdownBodyFromSource(input)
  return getMarkdownBody(input.workspaceID, input.documentID)
}
