import { readDocx } from '@/test-utils/docx'
import { captureDownloads } from '@/test-utils/download'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { DocumentExportDialog } from './document-export-dialog'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

afterEach(() => vi.restoreAllMocks())

// The first Word export loads and runs the whole builder, and other test files share
// this browser's main thread: the clicks go straight to the elements, as input sent
// from outside can wait behind them, and the test gets time for the work itself.
const click = (element: { element(): Element }) =>
  (element.element() as HTMLElement).click()

it(
  'downloads the document as <title>.docx and closes when Word is chosen',
  { timeout: 60_000 },
  async () => {
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
      await expect
        .element(page.getByRole('radio', { name: /Word/ }))
        .toBeEnabled()
      click(page.getByRole('radio', { name: /Word/ }))
      // Chosen and drawn before Export is pressed, as it is for a person.
      await expect
        .element(page.getByRole('radio', { name: /Word/ }))
        .toBeChecked()
      click(page.getByRole('button', { name: 'Export' }))
      await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false), {
        timeout: 45_000,
      })
    })

    expect(files.map((file) => file.name)).toEqual(['Q3-Q4 plan.docx'])
    const docx = await readDocx(files[0]!.bytes)
    expect(docx.paragraphs.find((p) => p.style === 'Heading1')?.text).toBe(
      'Plan'
    )
    expect(docx.paragraphs.some((p) => p.text === 'ship it')).toBe(true)
  }
)
