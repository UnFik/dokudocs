import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { NewDocumentMenu } from './new-document-menu'

describe('the New menu', () => {
  it('offers every document type, Architecture included', async () => {
    const onCreate = vi.fn()
    const screen = await render(<NewDocumentMenu onCreate={onCreate} />)
    await screen.getByRole('button', { name: 'New' }).click()
    for (const name of [
      'Markdown',
      'DB Diagram',
      'Mermaid diagram',
      'Architecture',
    ])
      await expect.element(screen.getByRole('menuitem', { name })).toBeVisible()
    await screen.getByRole('menuitem', { name: 'Architecture' }).click()
    expect(onCreate).toHaveBeenCalledWith('architecture')
  })
})
