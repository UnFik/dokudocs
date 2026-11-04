import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import type { ExportContext } from '../../lib/export-document'
import { DocumentExportDialog } from './document-export-dialog'

const { exportDocument, success } = vi.hoisted(() => ({
  exportDocument: vi.fn(),
  success: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success, error: vi.fn() } }))
vi.mock('../../lib/export-document', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/export-document')>()),
  exportDocument,
}))

const context: ExportContext = {
  documentID: 'b1f973dd-b554-4540-95c0-4697726ad6e1',
  workspaceID: '149a8d07-8490-43ed-98fa-ebaa91b05e90',
  title: 'Runbook',
  markdown: '# Runbook\n',
}

function openDialog(props: { offline?: boolean } = {}) {
  const onOpenChange = vi.fn()
  return {
    onOpenChange,
    ...render(
      <DocumentExportDialog
        open
        onOpenChange={onOpenChange}
        context={context}
        offline={props.offline ?? false}
      />
    ),
  }
}

beforeEach(() => {
  exportDocument.mockReset()
  success.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('DocumentExportDialog', () => {
  it('offers Markdown, PDF and Word, starting on PDF while online', async () => {
    await openDialog()

    const formats = page.getByRole('radiogroup', { name: 'Format' })
    await expect.element(formats).toBeInTheDocument()
    await expect
      .element(formats.getByRole('radio', { name: /Markdown.*\.md/ }))
      .toBeInTheDocument()
    await expect
      .element(formats.getByRole('radio', { name: /PDF.*\.pdf/ }))
      .toBeChecked()
    await expect
      .element(formats.getByRole('radio', { name: /Word.*\.docx/ }))
      .toBeInTheDocument()
  })

  it('shows PDF as unavailable offline, says why, and starts on Markdown', async () => {
    await openDialog({ offline: true })

    const pdf = page.getByRole('radio', { name: /PDF/ })
    await expect.element(pdf).toBeDisabled()
    await expect
      .element(pdf)
      .toHaveAccessibleDescription(/PDF needs a connection/)
    await expect
      .element(page.getByRole('radio', { name: /Markdown/ }))
      .toBeChecked()
    await expect
      .element(page.getByRole('radio', { name: /Word/ }))
      .toBeEnabled()
  })

  it('exports the chosen format, names the file in a message and closes', async () => {
    exportDocument.mockResolvedValue('Runbook.md')
    const { onOpenChange } = openDialog()

    await page.getByRole('radio', { name: /Markdown/ }).click()
    await page.getByRole('button', { name: 'Export' }).click()

    await vi.waitFor(() =>
      expect(exportDocument).toHaveBeenCalledWith('md', context)
    )
    await vi.waitFor(() =>
      expect(success).toHaveBeenCalledWith('Exported Runbook.md')
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows the name of the file the chosen format will produce', async () => {
    await openDialog()

    await expect.element(page.getByText('Runbook.pdf')).toBeInTheDocument()
    await page.getByRole('radio', { name: /Word/ }).click()
    await expect.element(page.getByText('Runbook.docx')).toBeInTheDocument()
  })

  it('moves off PDF when the connection drops while the dialog is open', async () => {
    const onOpenChange = vi.fn()
    const dialog = (offline: boolean) => (
      <DocumentExportDialog
        open
        onOpenChange={onOpenChange}
        context={context}
        offline={offline}
      />
    )
    exportDocument.mockResolvedValue('Runbook.md')
    const screen = await render(dialog(false))
    await expect.element(page.getByRole('radio', { name: /PDF/ })).toBeChecked()

    await screen.rerender(dialog(true))

    await expect
      .element(page.getByRole('radio', { name: /Markdown/ }))
      .toBeChecked()
    await page.getByRole('button', { name: 'Export' }).click()
    await vi.waitFor(() =>
      expect(exportDocument).toHaveBeenCalledWith('md', context)
    )
  })

  it('shows it is busy and refuses a second export while one runs', async () => {
    let finish: (name: string) => void = () => {}
    exportDocument.mockReturnValue(
      new Promise<string>((resolve) => (finish = resolve))
    )
    const { onOpenChange } = openDialog()

    await page.getByRole('button', { name: 'Export' }).click()

    const busy = page.getByRole('button', { name: /Exporting/ })
    await expect.element(busy).toBeDisabled()
    await busy.click({ force: true })
    expect(exportDocument).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalled()

    finish('Runbook.pdf')
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('stays open with the reason when an export fails, and the other formats still work', async () => {
    exportDocument.mockRejectedValueOnce(
      new Error('PDF export is unavailable right now')
    )
    const { onOpenChange } = openDialog()

    await page.getByRole('button', { name: 'Export' }).click()

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('PDF export is unavailable right now')
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(success).not.toHaveBeenCalled()

    exportDocument.mockResolvedValueOnce('Runbook.md')
    await page.getByRole('radio', { name: /Markdown/ }).click()
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
    await page.getByRole('button', { name: 'Export' }).click()
    await vi.waitFor(() =>
      expect(exportDocument).toHaveBeenLastCalledWith('md', context)
    )
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
