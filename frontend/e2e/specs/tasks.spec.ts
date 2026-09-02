import { test, expect, setAuthenticatedState } from '../fixtures/test-base'

test.describe('Tasks Management Flows', () => {
  test.beforeEach(async ({ page }) => {
    await setAuthenticatedState(page)
  })

  test('renders tasks table with data rows', async ({ page, tasksPage }) => {
    await tasksPage.goto()
    await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible()
    await tasksPage.expectRowCountAtLeast(1)
  })

  test('filters tasks by search input', async ({ page, tasksPage }) => {
    await tasksPage.goto()
    await tasksPage.searchTask('TASK')
    await expect(page.locator('tbody tr').first()).toBeVisible()
  })

  test('opens create task drawer', async ({ page, tasksPage }) => {
    await tasksPage.goto()
    await tasksPage.openCreateDrawer()
    await expect(page.getByRole('heading', { name: 'Create Task' })).toBeVisible()
  })
})
