import { type Page, type Locator, expect } from '@playwright/test'
import { BasePage } from './base.page'

export class UsersPage extends BasePage {
  readonly searchInput: Locator
  readonly inviteUserButton: Locator
  readonly addUserButton: Locator
  readonly tableRows: Locator

  constructor(page: Page) {
    super(page)
    this.searchInput = page.getByPlaceholder(/filter/i).first()
    this.inviteUserButton = page.getByRole('button', { name: /invite user/i })
    this.addUserButton = page.getByRole('button', { name: /add user/i })
    this.tableRows = page.locator('tbody tr')
  }

  async goto() {
    await super.goto('/users')
  }

  async searchUser(term: string) {
    await this.searchInput.fill(term)
  }

  async openInviteDialog() {
    await this.inviteUserButton.click()
  }

  async expectRowCountAtLeast(count: number) {
    await expect(this.tableRows.first()).toBeVisible()
    const rows = await this.tableRows.count()
    expect(rows).toBeGreaterThanOrEqual(count)
  }
}
