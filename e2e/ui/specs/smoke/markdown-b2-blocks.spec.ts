import { expect, test } from "@playwright/test";
import { openMarkdownDocument } from "../../helpers/markdown-document";

async function chooseBlock(page: import("@playwright/test").Page, filter: string, name: RegExp) {
  await page.keyboard.press("/");
  await page.keyboard.type(filter);
  await page.getByRole("option", { name }).click();
}

test("@live @smoke @blocks2: underline and highlight show, and survive a reload", async ({
  page,
}) => {
  const { editor } = await openMarkdownDocument(page, ["plain words"]);
  await editor.locator("p").first().click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Control+u");
  await expect(editor.locator("u").first()).toHaveText("plain words");

  await editor.locator("p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" ==marked==");
  await expect(editor.locator("mark")).toHaveText("marked");
  await expect(editor.locator("p").first()).toHaveText("plain words marked");

  await expect(page.getByRole("status")).toContainText("Synced");
  await page.reload();
  await expect(page.locator(".ProseMirror u").first()).toContainText("plain words");
  await expect(page.locator(".ProseMirror mark")).toHaveText("marked");
});

test("@live @smoke @blocks2: a notice, a toggle and a page break come from the block menu", async ({
  page,
}) => {
  const { editor } = await openMarkdownDocument(page, ["", ""]);
  await editor.locator("p").first().click();
  await chooseBlock(page, "warning", /Warning notice/);
  await page.keyboard.type("Mind the gap");
  const notice = editor.locator(".dd-notice-warning");
  await expect(notice).toContainText("Mind the gap");

  await editor.locator("p").last().click();
  await chooseBlock(page, "toggle", /^Toggle\s*\+\+\+$/);
  await page.keyboard.type("Details");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("Hidden until unfolded");
  const toggle = editor.locator(".dd-toggle");
  await expect(toggle.locator("p").nth(1)).toHaveText("Hidden until unfolded");
  await toggle.getByRole("button", { name: "Fold" }).click();
  await expect(toggle.getByText("Hidden until unfolded")).toBeHidden();
  await toggle.getByRole("button", { name: "Unfold" }).click();
  await expect(toggle.getByText("Hidden until unfolded")).toBeVisible();

  await page.locator(".dd-page-end").click();
  await page.keyboard.press("/");
  await page.keyboard.type("page");
  await page.getByRole("option", { name: /Page break/ }).click();
  await expect(editor.locator("hr.dd-page-break")).toHaveCount(1);
});

test("@live @smoke @blocks2: heading 4 and today's date come from the block menu", async ({
  page,
}) => {
  const { editor } = await openMarkdownDocument(page, ["", ""]);
  await editor.locator("p").first().click();
  await chooseBlock(page, "heading 4", /Heading 4/);
  await page.keyboard.type("Fourth");
  await expect(editor.locator("h4")).toHaveText("Fourth");

  await editor.locator("p").last().click();
  await chooseBlock(page, "date", /Current date/);
  await expect(editor.locator("p").last()).toHaveText(/\d{4}/);
});
