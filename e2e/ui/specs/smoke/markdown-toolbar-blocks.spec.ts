import { test, expect } from "@playwright/test";
import {
  expectNoInternalMessage,
  openMarkdownDocument,
  settleSelection,
} from "../../helpers/markdown-document";

// The selection toolbar turns the selected line into a heading, a quote, a
// toggle or a list, and shows which one the line already is.

expect.configure({ timeout: 15000 });

test("@live @smoke @markdowntoolbar: the selection toolbar sets headings and wraps a line", async ({
  page,
}) => {
  test.setTimeout(90000);
  const { editor } = await openMarkdownDocument(page, ["first line"]);
  const toolbar = page.getByRole("toolbar", { name: "Format selection" });
  const select = async () => {
    // Click, then select the line with the keys: retried until the browser has
    // the whole line selected, since the keys can reach the editor before it has
    // heard where the click put the caret.
    await expect(async () => {
      await editor.getByText("first line").first().click();
      await settleSelection(page, { collapsed: true });
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+End");
      expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
        "first line",
      );
    }).toPass({ timeout: 15_000 });
    await expect(toolbar).toBeVisible();
  };

  await select();
  await toolbar.getByRole("button", { name: "Heading 2" }).click();
  await expect(editor.locator("h2")).toHaveText("first line");
  await select();
  await expect(
    toolbar.getByRole("button", { name: "Heading 2" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    toolbar.getByRole("button", { name: "Bulleted list" }),
  ).toBeDisabled();
  await toolbar.getByRole("button", { name: "Heading 2" }).click();
  await expect(editor.locator("h2")).toHaveCount(0);

  for (const [name, selector] of [
    ["Bulleted list", "ul li"],
    ["Quote", "blockquote"],
  ] as const) {
    await select();
    await toolbar.getByRole("button", { name }).click();
    await expect(editor.locator(selector).first()).toContainText("first line");
    await page.keyboard.press("Control+z");
    await expect(editor.locator(selector)).toHaveCount(0);
  }
  await expectNoInternalMessage(page);
});
