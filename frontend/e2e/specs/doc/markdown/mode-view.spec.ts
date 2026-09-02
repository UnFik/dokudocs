import { test, expect, setAuthenticatedState } from '../../../fixtures/test-base'

test.describe('Markdown Editor - Mode View', () => {
  test.beforeEach(async ({ page }) => {
    await setAuthenticatedState(page)
  })

  test('prevents editing, typing, and keystrokes in View mode', async ({ page, docEditorPage }) => {
    await docEditorPage.goto('doc-1')

    const viewBtn = page.getByTestId('preview-mode-view')
    await expect(viewBtn).toBeVisible()
    await viewBtn.click()

    const editorRoot = page.locator('.muya-editor-root, .mu-editor').first()
    await expect(editorRoot).toHaveClass(/mu-read-only/)

    const initialText = await editorRoot.textContent()

    const paragraph = page.locator('.mu-paragraph').first()
    await expect(paragraph).toBeVisible()
    await paragraph.click()

    await page.keyboard.type(' UNWANTED TYPING IN VIEW MODE ')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Delete')

    const textAfterKeystrokes = await editorRoot.textContent()
    expect(textAfterKeystrokes).toBe(initialText)

    const isEditable = await page.evaluate(() => {
      const content = document.querySelector('.mu-paragraph .mu-content')
      return content?.getAttribute('contenteditable')
    })
    expect(isEditable === 'false' || isEditable === null).toBe(true)
  })

  test('hides drag handles and table drag containers in View mode', async ({ page, docEditorPage }) => {
    await docEditorPage.goto('doc-1')

    const viewBtn = page.getByTestId('preview-mode-view')
    await expect(viewBtn).toBeVisible()
    await viewBtn.click()

    const frontButton = page.locator('.mu-front-button-wrapper').first()
    await expect(frontButton).toBeHidden()

    const tableDragBar = page.locator('.mu-table-drag-container').first()
    await expect(tableDragBar).toBeHidden()
  })
})
