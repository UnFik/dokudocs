import { expect, test } from "@playwright/test";
import { openMarkdownDocument } from "../../helpers/markdown-document";

// Every block the + menu can add must be removable: with Backspace while it is
// still empty, and by choosing it with its handle.
const blocks: { name: string; option: RegExp; selector: string; keepsText?: boolean }[] = [
  { name: "heading 1", option: /^Heading 1/, selector: "h1" },
  { name: "heading 2", option: /^Heading 2/, selector: "h2" },
  { name: "heading 3", option: /^Heading 3/, selector: "h3" },
  { name: "heading 4", option: /^Heading 4/, selector: "h4" },
  { name: "bulleted list", option: /^Bulleted list/, selector: "ul" },
  { name: "numbered list", option: /^Numbered list/, selector: "ol" },
  { name: "task list", option: /^Task list/, selector: "ul" },
  { name: "quote", option: /^Quote/, selector: "blockquote" },
  { name: "code block", option: /^Code block/, selector: "pre" },
  { name: "table", option: /^Table/, selector: "table" },
  { name: "divider", option: /^Divider/, selector: "hr:not(.dd-page-break)" },
  { name: "math block", option: /^Math block/, selector: ".dd-math-block" },
  // A new diagram starts with sample source, so it is not empty: Backspace edits it.
  { name: "mermaid diagram", option: /^Mermaid diagram/, selector: ".dd-diagram-block", keepsText: true },
  { name: "info notice", option: /^Info notice/, selector: ".dd-notice-info" },
  { name: "success notice", option: /^Success notice/, selector: ".dd-notice-success" },
  { name: "warning notice", option: /^Warning notice/, selector: ".dd-notice-warning" },
  { name: "tip notice", option: /^Tip notice/, selector: ".dd-notice-tip" },
  { name: "toggle", option: /^Toggle\s*\+\+\+$/, selector: ".dd-toggle" },
  { name: "toggle heading", option: /^Toggle heading/, selector: ".dd-toggle" },
  { name: "page break", option: /^Page break/, selector: "hr.dd-page-break" },
];

async function insert(page: import("@playwright/test").Page, option: RegExp) {
  const { editor } = await openMarkdownDocument(page, ["", "after"]);
  await editor.locator("p").first().click();
  await page.keyboard.press("/");
  await page.getByRole("option", { name: option }).click();
  return editor;
}

for (const block of blocks) {
  const emptyTest = block.keepsText ? test.skip : test;
  emptyTest(`@live @smoke @blockremoval: ${block.name} goes with Backspace while empty`, async ({ page }) => {
    test.setTimeout(60000);
    const editor = await insert(page, block.option);
    await expect(editor.locator(block.selector)).toHaveCount(1);
    await page.keyboard.press("Backspace");
    // A heading or list first turns back into a line; a second press is harmless.
    if ((await editor.locator(block.selector).count()) > 0) await page.keyboard.press("Backspace");
    await expect(editor.locator(block.selector)).toHaveCount(0);
    await expect(editor).toContainText("after");
  });

  test(`@live @smoke @blockremoval: ${block.name} goes when chosen with its handle`, async ({ page }) => {
    test.setTimeout(60000);
    const editor = await insert(page, block.option);
    await expect(editor.locator(block.selector)).toHaveCount(1);
    await editor.locator(block.selector).first().hover();
    await page.locator(".dd-handle:not([hidden])").click();
    await page.keyboard.press("Backspace");
    await expect(editor.locator(block.selector)).toHaveCount(0);
    await expect(editor).toContainText("after");
  });
}
