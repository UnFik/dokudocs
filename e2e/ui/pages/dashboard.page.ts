import { type Page, type Locator } from '@playwright/test'
import { BasePage } from './base.page'

export class DashboardPage extends BasePage {
  readonly createDocDropdown: Locator

  constructor(page: Page) {
    super(page)
    this.createDocDropdown = page.getByRole('button', { name: /new/i }).first()
  }

  async goto() {
    await super.goto('/')
  }

  async selectFilterTab(tabName: 'All' | 'Created by me' | 'Shared with me' | 'Starred') {
    const tabButton = this.page.getByRole('button', { name: new RegExp(tabName, 'i') }).first()
    await tabButton.click()
  }

  async openDocByTitle(title: string) {
    const card = this.page.getByText(title).first()
    await card.click()
  }

  async openNewDocModal(type: 'markdown' | 'dbdiagram' | 'mermaid') {
    await this.createDocDropdown.click()
    if (type === 'markdown') {
      await this.page.getByRole('menuitem', { name: /markdown/i }).first().click()
    } else if (type === 'dbdiagram') {
      await this.page.getByRole('menuitem', { name: /db diagram/i }).first().click()
    } else {
      await this.page.getByRole('menuitem', { name: /flowchart/i }).first().click()
    }
  }

  async triggerSignOut() {
    const userBtn = this.page.locator('[data-slot="sidebar-container"] [data-slot="sidebar-footer"] button, [data-sidebar="footer"] button').last()
    await userBtn.click()
    const logoutItem = this.page.getByRole('menuitem', { name: /logout/i })
    await logoutItem.click()
    const confirmBtn = this.page.getByRole('button', { name: /^sign out$/i })
    await confirmBtn.click()
  }
}
