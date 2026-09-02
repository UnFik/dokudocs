import { type Page, expect } from '@playwright/test'

export class BasePage {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  async goto(path: string) {
    await this.page.goto(path, { waitUntil: 'domcontentloaded' })
  }

  async waitForUrl(urlPattern: string | RegExp) {
    await this.page.waitForURL(urlPattern, { waitUntil: 'domcontentloaded' })
  }

  async expectToast(message: string | RegExp) {
    const toast = this.page.locator('[data-sonner-toast]').filter({ hasText: message }).first()
    await expect(toast).toBeVisible()
  }
}
