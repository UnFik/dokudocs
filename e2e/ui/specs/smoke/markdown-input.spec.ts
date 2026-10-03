import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  expectNoInternalMessage,
  openMarkdownDocument,
  pastePlainText,
} from "../../helpers/markdown-document";

// Real keyboard, real clipboard event, real editor and server: the ways text
// becomes Markdown structure without a toolbar.

expect.configure({ timeout: 15000 });

const prd = readFileSync(
  new URL("../../fixtures/prd-nata.md", import.meta.url),
  "utf8",
);

test("@live @smoke @markdowninput: pasting a whole Markdown document keeps its structure and persists", async ({
  page,
}) => {
  test.setTimeout(90000);
  const { editor } = await openMarkdownDocument(page, ["start"]);
  await editor.locator("p").first().click();
  await page.keyboard.press("End");
  await pastePlainText(page, prd);

  await expect(editor.locator("h1")).toHaveCount(1);
  await expect(editor.locator("h2")).toHaveCount(4);
  await expect(editor.locator("h3")).toHaveCount(4);
  await expect(editor.locator("table")).toHaveCount(3);
  await expect(editor.locator("ol")).not.toHaveCount(0);
  await expect(editor.locator("ul")).not.toHaveCount(0);
  await expect(editor.locator("strong").first()).toBeVisible();
  await expectNoInternalMessage(page);

  await expect(page.getByRole("status")).toContainText("Synced");
  await page.reload();
  await expect(page.getByRole("status")).toContainText("Synced");
  await expect(editor.locator("h2")).toHaveCount(4);
  await expect(editor.locator("table")).toHaveCount(3);
  await expectNoInternalMessage(page);
});

test("@live @smoke @markdowninput: a paste the importer cannot read lands as plain lines instead of vanishing", async ({
  page,
}) => {
  test.setTimeout(60000);
  const { editor } = await openMarkdownDocument(page, ["start"]);
  await editor.locator("p").first().click();
  await page.keyboard.press("End");
  // A list item that ends in spaces before a blank line is what broke the strict import.
  await pastePlainText(page, "* first  \n* last  \n\n**after** the list\n");
  await expect(editor.locator("li")).toHaveCount(2);
  await expect(editor).toContainText("after the list");
  await expectNoInternalMessage(page);
});
