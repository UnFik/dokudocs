import { type Page, type Locator, expect } from '@playwright/test'
import { BasePage } from './base.page'

export class LoginPage extends BasePage {
  readonly emailInput: Locator
  readonly passwordInput: Locator
  readonly submitButton: Locator

  constructor(page: Page) {
    super(page)
    this.emailInput = page.locator('input[name="email"]')
    this.passwordInput = page.locator('input[name="password"]')
    this.submitButton = page.getByRole('button', { name: /sign in/i })
  }

  async goto() {
    await super.goto('/sign-in')
  }

  async login(email: string, pass: string) {
    await this.emailInput.fill(email)
    await this.passwordInput.fill(pass)
    await this.submitButton.click()
  }

  async expectValidationError(message: string | RegExp) {
    const errorMsg = this.page.locator('[aria-live="polite"], [role="alert"], p.text-destructive, p.text-red-500').filter({ hasText: message }).first()
    await expect(errorMsg).toBeVisible()
  }
}
