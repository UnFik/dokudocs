import { vi } from 'vitest'

// Kept from before a test stubs fetch: reading the blob address must not hit the stub.
const realFetch = globalThis.fetch.bind(globalThis)

export type DownloadedFile = { name: string; type: string; bytes: Uint8Array }

/**
 * The files the page asks the browser to save while `run` executes: the name it
 * suggested and the bytes it offered. Call `vi.restoreAllMocks()` afterwards.
 */
export async function captureDownloads(
  run: () => unknown
): Promise<DownloadedFile[]> {
  const reads: Promise<DownloadedFile>[] = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    const { href, download } = this
    reads.push(
      realFetch(href).then(async (response) => {
        const blob = await response.blob()
        return {
          name: download,
          type: blob.type,
          bytes: new Uint8Array(await blob.arrayBuffer()),
        }
      })
    )
  })
  await run()
  return Promise.all(reads)
}
