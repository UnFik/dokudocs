import { testSession } from '@/test-utils/auth'
import { captureDownloads } from '@/test-utils/download'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { exportDocument, type ExportContext } from './export-document'

const context: ExportContext = {
  documentID: 'b1f973dd-b554-4540-95c0-4697726ad6e1',
  workspaceID: '149a8d07-8490-43ed-98fa-ebaa91b05e90',
  title: 'Q3/Q4 plan',
  markdown: '# Plan\n\nShip **it**.\n',
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  useAuthStore.getState().auth.setSession(testSession())
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  useAuthStore.getState().auth.reset()
})

describe('exportDocument as PDF', () => {
  it('sends the page the reader sees, with their session, and saves the PDF that comes back', async () => {
    fetchMock.mockResolvedValue(
      new Response('%PDF-1.7 fake', {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      })
    )

    let name = ''
    const [file] = await captureDownloads(async () => {
      name = await exportDocument('pdf', context)
    })

    expect(name).toBe('Q3-Q4 plan.pdf')
    expect(file!.name).toBe('Q3-Q4 plan.pdf')
    expect(new TextDecoder().decode(file!.bytes)).toBe('%PDF-1.7 fake')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(new URL(url as string).pathname).toBe(
      `/api/v1/documents/${context.documentID}/export/pdf`
    )
    expect(init.method).toBe('POST')
    const headers = new Headers(init.headers)
    expect(headers.get('X-Workspace-Id')).toBe(context.workspaceID)
    expect(headers.get('Authorization')).toMatch(/^Bearer .+/)
    expect(headers.get('Content-Type')).toBe('application/json')
    const body = JSON.parse(init.body as string)
    expect(body.title).toBe('Q3/Q4 plan')
    expect(body.html).toContain('<article class="markdown-body">')
    expect(body.html).toContain('<strong>it</strong>')
  })

  it.each([
    [413, 'the document is too large to export as PDF (the limit is 8 MB)'],
    [429, 'too many requests, try again later'],
    [502, 'the document could not be printed to PDF'],
    [503, 'PDF export is unavailable right now'],
    [503, 'PDF export is busy, try again in a moment'],
    [504, 'PDF export took too long'],
    [403, 'forbidden'],
  ])(
    'fails with the reason the server gave for a %i',
    async (status, title) => {
      fetchMock.mockImplementation(async () =>
        Response.json({ title }, { status })
      )

      await expect(exportDocument('pdf', context)).rejects.toThrow(title)
    }
  )

  it('says it needs a connection when the server cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(exportDocument('pdf', context)).rejects.toThrow(
      'PDF export needs a connection'
    )
  })

  it('does not save anything when the PDF could not be made', async () => {
    fetchMock.mockImplementation(async () =>
      Response.json(
        { title: 'PDF export is unavailable right now' },
        { status: 503 }
      )
    )

    const files = await captureDownloads(() =>
      exportDocument('pdf', context).catch(() => undefined)
    )

    expect(files).toEqual([])
  })
})
