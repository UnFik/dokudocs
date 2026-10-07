import { apiBlob, apiFetch } from '@/lib/api-client'
import type { UploadedFile } from './prosemirror/blocks/uploads'

export async function uploadDocumentAsset(
  workspaceID: string,
  documentID: string,
  file: File
): Promise<UploadedFile> {
  const form = new FormData()
  form.append('file', file)
  return apiFetch<UploadedFile>(
    `/api/v1/documents/${documentID}/assets`,
    {
      method: 'POST',
      body: form,
      headers: { 'X-Workspace-ID': workspaceID },
    }
  )
}

const loaded = new Map<string, Promise<string>>()

/** One blob address per stored file, kept for the life of the page. */
export function assetObjectURL(
  workspaceID: string,
  src: string
): Promise<string> {
  let url = loaded.get(src)
  if (!url) {
    url = apiBlob(`${src}?workspace_id=${workspaceID}`).then((blob) => URL.createObjectURL(blob))
    url.catch(() => loaded.delete(src))
    loaded.set(src, url)
  }
  return url
}
