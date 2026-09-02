import { test, expect, setAuthenticatedState } from '../../../fixtures/test-base'

test.describe('Markdown Editor - Mode Edit', () => {
  test.beforeEach(async ({ page }) => {
    await setAuthenticatedState(page)
  })

  test('allows direct write-in editing in Muya editor and shows comments sidebar', async ({ page, docEditorPage }) => {
    await docEditorPage.goto('doc-1')

    const editBtn = page.getByTestId('preview-mode-edit')
    await expect(editBtn).toBeVisible()
    await editBtn.click()

    await docEditorPage.toggleComments()
    const sidebar = page.locator('aside, [data-sidebar="comments"]').or(page.getByText('Comments')).first()
    await expect(sidebar).toBeVisible()

    await page.evaluate(() => {
      const win = window as unknown as {
        useCommentStore?: {
          getState: () => {
            addThread: (payload: {
              docId: string
              selectedText: string
              content: string
              author: { id: string; name: string; email: string; avatar: string }
            }) => void
          }
        }
      }

      win.useCommentStore?.getState().addThread({
        docId: 'doc-1',
        selectedText: 'Draft Architecture',
        content: 'Please review this section.',
        author: {
          id: 'usr-1',
          name: 'Fikri',
          email: 'fikri@dokudocs.app',
          avatar: '/avatars/01.png',
        },
      })
    })

    const initialCard = sidebar.locator('div', { hasText: 'Please review this section.' }).first()
    await expect(initialCard).toBeVisible()
  })

  test('triggers autosave and persists direct keyboard typing in Muya editor across navigation', async ({ page, docEditorPage }) => {
    await docEditorPage.goto('doc-1')

    const editBtn = page.getByTestId('preview-mode-edit')
    await expect(editBtn).toBeVisible()
    await editBtn.click()

    await page.evaluate(() => {
      const p = document.querySelector('.mu-paragraph .mu-paragraph-content, .mu-paragraph .mu-content')
      if (p) {
        const sel = window.getSelection()
        const range = document.createRange()
        range.selectNodeContents(p)
        range.collapse(false)
        sel?.removeAllRanges()
        sel?.addRange(range)
        ;(p as HTMLElement).focus()
      }
    })

    await page.keyboard.type(' DirectEdit')

    const editorText = await page.locator('.muya-editor-root').textContent()
    expect(editorText).toContain('DirectEdit')

    await expect.poll(async () => {
      return await page.evaluate(() => {
        const win = window as unknown as {
          useDokudocsStore?: {
            getState: () => {
              documents: Array<{ id: string; content: string }>
            }
          }
        }
        const currentDoc = win.useDokudocsStore?.getState().documents.find((d) => d.id === 'doc-1')
        return currentDoc?.content || ''
      })
    }, { timeout: 5000 }).toContain('DirectEdit')

    await page.goto('/')
    await expect(page).toHaveURL('/')

    await docEditorPage.goto('doc-1')
    const reloadedText = await page.locator('.muya-editor-root').textContent()
    expect(reloadedText).toContain('DirectEdit')
  })
})
