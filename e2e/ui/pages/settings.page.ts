import { type Page, expect } from '@playwright/test'
import { BasePage } from './base.page'

export class SettingsPage extends BasePage {
  constructor(page: Page) {
    super(page)
  }

  async goto() {
    await super.goto('/settings')
  }

  async selectTab(name: 'General' | 'Billing' | 'Members' | 'Notifications') {
    const tabTrigger = this.page.getByRole('tab', { name: new RegExp(name, 'i') })
    await tabTrigger.click()
  }

  async expectSectionTitle(title: string | RegExp) {
    const heading = this.page.getByRole('heading', { name: title }).first()
    await expect(heading).toBeVisible()
  }
}
