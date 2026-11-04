import { captureDownloads } from '@/test-utils/download'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { DocumentExportDialog } from './document-export-dialog'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

afterEach(() => vi.restoreAllMocks())

it('downloads the document as <title>.md and closes when Markdown is chosen', async () => {
  const onOpenChange = vi.fn()
  await render(
    <DocumentExportDialog
      open
      onOpenChange={onOpenChange}
      offline
      context={{
        documentID: 'b1f973dd-b554-4540-95c0-4697726ad6e1',
        workspaceID: '149a8d07-8490-43ed-98fa-ebaa91b05e90',
        title: 'Q3/Q4 plan',
        markdown: '# Plan\n\n- ship it\n',
      }}
    />
  )

  const files = await captureDownloads(async () => {
    await page.getByRole('radio', { name: /Markdown/ }).click()
    await page.getByRole('button', { name: 'Export' }).click()
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  expect(files.map((file) => file.name)).toEqual(['Q3-Q4 plan.md'])
  expect(new TextDecoder().decode(files[0]!.bytes)).toBe(
    '# Plan\n\n- ship it\n'
  )
})
