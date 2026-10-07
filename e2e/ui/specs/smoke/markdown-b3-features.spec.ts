import { expect, test } from "@playwright/test";
import { openMarkdownDocument } from "../../helpers/markdown-document";

test("@live @smoke @features3: find and replace across the page", async ({ page }) => {
  const { editor } = await openMarkdownDocument(page, ["the cat sat", "another Cat here"]);
  await editor.locator("p").first().click();
  await page.keyboard.press("Control+f");
  const find = page.getByRole("textbox", { name: "Find" });
  await expect(find).toBeFocused();
  await find.fill("cat");
  await expect(page.locator(".dd-find-count")).toHaveText("1 of 2");
  await find.press("Enter");
  await expect(page.locator(".dd-find-count")).toHaveText("2 of 2");

  await page.getByRole("textbox", { name: "Replace with" }).fill("dog");
  await page.getByRole("button", { name: "Replace all" }).click();
  await expect(editor).toContainText("the dog sat");
  await expect(editor).toContainText("another dog here");
  await find.press("Escape");
  await expect(page.getByRole("search", { name: "Find in page" })).toHaveCount(0);
});

test("@live @smoke @features3: statistics dialog and numbered headings", async ({ page }) => {
  const { editor } = await openMarkdownDocument(page, ["", "some words in a paragraph", ""]);
  await editor.locator("p").first().click();
  await page.keyboard.type("# ");
  await page.keyboard.type("Alpha");
  await editor.locator("p").last().click();
  await page.keyboard.type("## ");
  await page.keyboard.type("Beta");

  await page.keyboard.press("Control+Shift+g");
  const dialog = page.getByRole("dialog", { name: "Page statistics" });
  await expect(dialog).toContainText("Words");
  await expect(dialog).toContainText("Headings");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Number headings" }).click();
  await expect(editor.locator("h1")).toHaveAttribute("data-heading-number", "1");
  await expect(editor.locator("h2")).toHaveAttribute("data-heading-number", "1.1");
});

test("@live @smoke @features3: a pasted link, and its hover card", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { editor } = await openMarkdownDocument(page, ["read the docs"]);
  await editor.locator("p").first().dblclick();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "https://example.com/docs");
    document.querySelector(".ProseMirror")!.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  const link = editor.locator("[data-link-href]").first();
  await expect(link).toHaveAttribute("data-link-href", "https://example.com/docs");
  await link.hover();
  const card = page.locator(".dd-link-card");
  await expect(card).toContainText("https://example.com/docs");
  await expect(card.getByRole("link", { name: "Open link" })).toHaveAttribute("rel", "noopener noreferrer");
});

test("@live @smoke @features3: @ mentions a person and : picks an emoji", async ({ page }) => {
  const { editor } = await openMarkdownDocument(page, [""]);
  await editor.locator("p").first().click();
  await page.keyboard.press("@");
  const menu = page.getByRole("combobox", { name: "Mention" });
  await expect(menu).toBeFocused();
  await menu.fill("System");
  await page.getByRole("option").first().click();
  await expect(editor.locator(".dd-mention")).toContainText("@System");

  await page.keyboard.type(" ");
  await page.keyboard.press(":");
  const emoji = page.getByRole("combobox", { name: "Emoji" });
  await emoji.fill("tada");
  await emoji.press("Enter");
  await expect(editor).toContainText("🎉");
});
