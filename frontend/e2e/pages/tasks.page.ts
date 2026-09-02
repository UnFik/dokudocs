import { type Page, type Locator, expect } from '@playwright/test'
import { BasePage } from './base.page'

export class TasksPage extends BasePage {
  readonly searchInput: Locator
  readonly createButton: Locator
  readonly tableRows: Locator

  constructor(page: Page) {
    super(page)
    this.searchInput = page.getByPlaceholder(/filter/i).first()
    this.createButton = page.getByRole('button', { name: /create/i })
    this.tableRows = page.locator('tbody tr')
  }

  async goto() {
    await super.goto('/tasks')
  }

  async searchTask(term: string) {
    await this.searchInput.fill(term)
  }

  async openCreateDrawer() {
    await this.createButton.click()
  }

  async expectRowCountAtLeast(count: number) {
    await expect(this.tableRows.first()).toBeVisible()
    const rows = await this.tableRows.count()
    expect(rows).toBeGreaterThanOrEqual(count)
  }
}
