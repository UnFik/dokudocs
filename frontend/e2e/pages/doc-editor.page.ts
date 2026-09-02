import { type Page, type Locator, expect } from '@playwright/test'
import { BasePage } from './base.page'

export class DocEditorPage extends BasePage {
  readonly titleElement: Locator
  readonly commentsButton: Locator
  readonly shareButton: Locator
  readonly exportButton: Locator

  constructor(page: Page) {
    super(page)
    this.titleElement = page.locator('header h1')
    this.commentsButton = page.getByRole('button', { name: /comments/i })
    this.shareButton = page.getByRole('button', { name: /share/i })
    this.exportButton = page.getByRole('button', { name: /export/i })
  }

  async goto(docId: string) {
    await super.goto(`/docs/${docId}`)
  }

  async editTitle(newTitle: string) {
    await this.titleElement.click()
    const input = this.page.locator('header input')
    await input.fill(newTitle)
    await input.press('Enter')
  }

  async toggleComments() {
    await this.commentsButton.click()
  }

  async exportRawCode() {
    await this.exportButton.click()
    await this.page.getByRole('menuitem', { name: /copy raw code/i }).click()
  }

  async expectCanvasRendered() {
    const canvas = this.page.locator('[data-preview-layer], .dokudocs-preview-svg, canvas, #mermaid-canvas-layer, svg').first()
    await expect(canvas).toBeVisible()
  }
}
