import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  expectNoInternalMessage,
  openMarkdownDocument,
  pastePlainText,
} from "../../helpers/markdown-document";

// A real document (the PRD fixture, pasted) has headings, lists and tables. A
// line that still has text must merge into the line above whatever the two are,
// and a selection that reaches into a table must delete without a message.

expect.configure({ timeout: 15000 });

const prd = readFileSync(
  new URL("../../fixtures/prd-nata.md", import.meta.url),
  "utf8",
);

async function openPasted(page: Page) {
  const { editor } = await openMarkdownDocument(page, ["start"]);
  await editor.locator("p").first().click();
  await page.keyboard.press("End");
  await pastePlainText(page, prd);
  await expect(editor.locator("table")).toHaveCount(3);
  await expect(page.getByRole("status")).toContainText("Synced");
  return editor;
}

async function backspaceAtStart(page: Page, line: Locator) {
  await line.click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Backspace");
}

test("@live @smoke @linemerge: a paragraph under a heading merges into the heading", async ({
  page,
}) => {
  test.setTimeout(120000);
  const editor = await openPasted(page);
  await backspaceAtStart(
    page,
    editor.locator("p").filter({ hasText: "NATA Project berkembang" }),
  );
  await expect(
    editor.locator("h2").filter({ hasText: "Latar BelakangNATA Project" }),
  ).toHaveCount(1);
  await expectNoInternalMessage(page);
  await page.reload();
  await expect(page.getByRole("status")).toContainText("Synced");
  await expect(
    editor.locator("h2").filter({ hasText: "Latar BelakangNATA Project" }),
  ).toHaveCount(1);
});

test("@live @smoke @linemerge: a heading under a paragraph merges into the paragraph", async ({
  page,
}) => {
  test.setTimeout(120000);
  const editor = await openPasted(page);
  const headings = await editor.locator("h2").count();
  await backspaceAtStart(
    page,
    editor.locator("h2").filter({ hasText: "Tujuan & Acceptance" }),
  );
  await expect(editor.locator("h2")).toHaveCount(headings - 1);
  await expect(
    editor.locator("p").filter({ hasText: "dieksekusi secara koheren.2" }),
  ).toHaveCount(1);
  await expectNoInternalMessage(page);
});

test("@live @smoke @linemerge: a list item merges into the item above, and the line after a list into its last item", async ({
  page,
}) => {
  test.setTimeout(120000);
  const editor = await openPasted(page);
  const items = await editor.locator("li").count();
  await backspaceAtStart(
    page,
    editor.locator("li").filter({ hasText: "Kategorisasi issue belum" }),
  );
  await expect(editor.locator("li")).toHaveCount(items - 1);
  await expect(
    editor.locator("li").filter({ hasText: "developer baru.Kategorisasi" }),
  ).toHaveCount(1);
  await expectNoInternalMessage(page);

  await backspaceAtStart(
    page,
    editor.locator("p").filter({ hasText: "PRD ini menggabungkan" }),
  );
  await expect(
    editor.locator("li").filter({ hasText: "perubahan.PRD ini" }),
  ).toHaveCount(1);
  await expectNoInternalMessage(page);
});

test("@live @smoke @linemerge: Backspace at the start of the line after a table moves the caret into it and changes nothing", async ({
  page,
}) => {
  test.setTimeout(120000);
  const editor = await openPasted(page);
  const blocks = await editor.locator("p").count();
  await backspaceAtStart(
    page,
    editor.locator("p").filter({ hasText: "Repo Frontend berisi aplikasi" }),
  );
  await expect(editor.locator("p")).toHaveCount(blocks);
  await expect(editor.locator("table")).toHaveCount(3);
  await expectNoInternalMessage(page);
});

test("@live @smoke @linemerge: deleting a selection from a heading into a table clears the cells and keeps the table, with no message", async ({
  page,
}) => {
  test.setTimeout(120000);
  const editor = await openPasted(page);
  await editor.locator("h2").filter({ hasText: "Tujuan & Acceptance" }).click();
  await page.evaluate(() => {
    const heading = [...document.querySelectorAll(".ProseMirror h2")]
      .find((node) => node.textContent?.includes("Tujuan"))!
      .querySelector("span")!.firstChild!;
    const cell = [...document.querySelectorAll(".ProseMirror td")]
      .find((node) => node.textContent?.includes("Sub-category"))!
      .querySelector("span")!.firstChild!;
    window.getSelection()!.setBaseAndExtent(heading, 4, cell, 6);
  });
  await page.waitForTimeout(300);
  await page.keyboard.press("Backspace");
  await expect(
    editor.locator("td").filter({ hasText: "Sub-category" }),
  ).toHaveCount(0);
  await expect(editor.locator("table")).toHaveCount(3);
  await expectNoInternalMessage(page);
  await expect(page.getByRole("status")).toContainText("Synced");
  await page.reload();
  await expect(page.getByRole("status")).toContainText("Synced");
  await expect(editor.locator("table")).toHaveCount(3);
});
