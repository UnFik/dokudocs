import { test, expect, type Page } from "@playwright/test";
import {
  expectNoInternalMessage,
  openMarkdownDocument,
  pastePlainText,
} from "../../helpers/markdown-document";

// The controls that sit on a table: bars on the rows and columns, a menu per
// bar, ranges picked with Shift, and a drag that shows where the move lands.

expect.configure({ timeout: 15000 });

const table =
  "\n\n| Key | Value | Note |\n| :-- | :-- | :-- |\n| Method | GET | a |\n| URL | /member | b |\n| Auth | Bearer | c |\n";

async function openTable(page: Page) {
  const { editor } = await openMarkdownDocument(page, ["start"]);
  await editor.locator("p").first().click();
  await page.keyboard.press("End");
  await pastePlainText(page, table);
  await editor.locator("td").nth(4).click();
  return editor;
}

const column = (page: Page, n: number) =>
  page.getByRole("button", { name: `Column ${n}`, exact: true });
const row = (page: Page, n: number) =>
  page.getByRole("button", { name: `Row ${n}`, exact: true });
const firstColumn = (editor: ReturnType<Page["locator"]>) =>
  editor.locator("tr").evaluateAll((rows) =>
    rows.map((r) => (r.firstElementChild as HTMLElement).innerText.trim()),
  );

test("@live @smoke @tablecontrols: bars follow the caret, and a range of columns is deleted from the menu", async ({
  page,
}) => {
  test.setTimeout(90000);
  const editor = await openTable(page);
  await expect(page.locator(".dd-tc-bar")).toHaveCount(7);
  await editor.locator("p").first().click();
  await expect(page.locator(".dd-tc-bar")).toHaveCount(0);
  await editor.locator("td").first().click();

  await column(page, 2).click();
  await column(page, 3).click({ modifiers: ["Shift"] });
  await expect(editor.locator("td.dd-tc-selected")).toHaveCount(8);
  await page.getByRole("menuitem", { name: "Delete 2 columns" }).click();
  await expect(editor.locator("tr").first().locator("td")).toHaveCount(1);
  await expectNoInternalMessage(page);
});

test("@live @smoke @tablecontrols: a menu inserts as many rows as are selected", async ({
  page,
}) => {
  test.setTimeout(90000);
  const editor = await openTable(page);
  await row(page, 2).click();
  await row(page, 3).click({ modifiers: ["Shift"] });
  await page.getByRole("menuitem", { name: "Insert 2 rows below" }).click();
  await expect(editor.locator("tr")).toHaveCount(6);
  await page.keyboard.type("new");
  await expect(editor.locator("tr").nth(3)).toContainText("new");
  await expectNoInternalMessage(page);
});

test("@live @smoke @tablecontrols: dragging a row shows the move and lands where the line was", async ({
  page,
}) => {
  test.setTimeout(90000);
  const editor = await openTable(page);
  expect(await firstColumn(editor)).toEqual(["Key", "Method", "URL", "Auth"]);

  await row(page, 2).click();
  await page.keyboard.press("Escape");
  const grip = await row(page, 2).boundingBox();
  const target = await editor.locator("tr").nth(3).boundingBox();
  await page.mouse.move(grip!.x + 4, grip!.y + grip!.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip!.x + 4, grip!.y + grip!.height / 2 + 12, {
    steps: 4,
  });
  await page.mouse.move(grip!.x + 4, target!.y + target!.height - 4, {
    steps: 8,
  });
  await expect(editor.locator("td.dd-tc-moving")).toHaveCount(3);
  await expect(editor.locator("td.dd-tc-drop-bottom")).toHaveCount(3);
  await expect(page.locator(".dd-tc-ghost")).toContainText("Moving 1 row");
  await page.mouse.up();

  await expect(editor.locator("td.dd-tc-moving")).toHaveCount(0);
  expect(await firstColumn(editor)).toEqual(["Key", "URL", "Auth", "Method"]);
  await expect(page.getByRole("status").first()).toContainText("Synced");
  await page.reload();
  await expect(page.getByRole("status").first()).toContainText("Synced");
  expect(await firstColumn(page.locator(".ProseMirror"))).toEqual([
    "Key",
    "URL",
    "Auth",
    "Method",
  ]);
  await expectNoInternalMessage(page);
});

test("@live @smoke @tablecontrols: dragging a column moves it in every row; Escape cancels a drag", async ({
  page,
}) => {
  test.setTimeout(90000);
  const editor = await openTable(page);
  await column(page, 1).click();
  await page.keyboard.press("Escape");
  const grip = await column(page, 1).boundingBox();
  const last = await editor.locator("tr").first().locator("td").nth(2).boundingBox();

  await page.mouse.move(grip!.x + 6, grip!.y + 3);
  await page.mouse.down();
  await page.mouse.move(grip!.x + 20, grip!.y + 3, { steps: 4 });
  await page.mouse.move(last!.x + last!.width - 4, grip!.y + 3, { steps: 8 });
  await expect(editor.locator("td.dd-tc-drop-right")).toHaveCount(4);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(editor.locator("td.dd-tc-moving")).toHaveCount(0);
  expect(await firstColumn(editor)).toEqual(["Key", "Method", "URL", "Auth"]);

  await column(page, 1).click();
  await page.keyboard.press("Escape");
  const again = await column(page, 1).boundingBox();
  await page.mouse.move(again!.x + 6, again!.y + 3);
  await page.mouse.down();
  await page.mouse.move(again!.x + 20, again!.y + 3, { steps: 4 });
  await page.mouse.move(last!.x + last!.width - 4, again!.y + 3, { steps: 8 });
  await page.mouse.up();
  expect(await firstColumn(editor)).toEqual(["Value", "GET", "/member", "Bearer"]);
  await expectNoInternalMessage(page);
});

test("@live @smoke @tablecontrols: at phone width the bars do not widen the page", async ({
  page,
}) => {
  test.setTimeout(90000);
  const editor = await openTable(page);
  await page.setViewportSize({ width: 375, height: 700 });
  await editor.locator("td").nth(4).click();
  await expect(page.locator(".dd-tc-bar").first()).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(375);
  await expect(editor.locator("table")).toBeVisible();
  await expectNoInternalMessage(page);
});

test("@live @smoke @tablecontrols: stretching a column and a row keeps the size after a reload, and double-click resets it", async ({
  page,
}) => {
  test.setTimeout(90000);
  const editor = await openTable(page);
  const cell = editor.locator("tr").first().locator("td").first();
  const before = (await cell.boundingBox())!;

  const handle = page.locator(".dd-tc-resize-column").first();
  const grip = (await handle.boundingBox())!;
  // The edge runs down the whole column, so it can be grabbed from the middle of the table.
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height - 12);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 40, grip.y + grip.height - 12, { steps: 6 });
  await page.mouse.move(grip.x + grip.width / 2 + 80, grip.y + grip.height - 12, { steps: 6 });
  await page.mouse.up();
  const after = (await cell.boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width + 60);

  const rowHandle = page.locator(".dd-tc-resize-row").first();
  const rowGrip = (await rowHandle.boundingBox())!;
  const rowBefore = (await editor.locator("tr").first().boundingBox())!;
  await page.mouse.move(rowGrip.x + 4, rowGrip.y + rowGrip.height / 2);
  await page.mouse.down();
  await page.mouse.move(rowGrip.x + 4, rowGrip.y + 30, { steps: 6 });
  await page.mouse.up();
  expect((await editor.locator("tr").first().boundingBox())!.height).toBeGreaterThan(
    rowBefore.height + 20,
  );

  await expect(page.getByRole("status").first()).toContainText("Synced");
  await page.reload();
  await expect(page.getByRole("status").first()).toContainText("Synced");
  const reloaded = page.locator(".ProseMirror").locator("tr").first().locator("td").first();
  expect((await reloaded.boundingBox())!.width).toBeGreaterThan(before.width + 60);

  await editor.locator("td").nth(4).click();
  await page.locator(".dd-tc-resize-column").first().dblclick();
  await expect
    .poll(async () => (await reloaded.boundingBox())!.width)
    .toBeLessThan(before.width + 10);
  await expectNoInternalMessage(page);
});

test("@live @smoke @tablecontrols: dragging across the bars selects the rows and columns between them", async ({
  page,
}) => {
  test.setTimeout(90000);
  const editor = await openTable(page);
  const first = (await row(page, 2).boundingBox())!;
  const last = (await row(page, 4).boundingBox())!;
  await page.mouse.move(first.x + 4, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + 4, first.y + first.height / 2 + 12, { steps: 4 });
  await page.mouse.move(last.x + 4, last.y + last.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(editor.locator("td.dd-tc-selected")).toHaveCount(9);
  // The browser's own text selection must not stretch across the other cells.
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
  await expect(page.getByRole("menuitem", { name: "Delete 3 rows" })).toBeVisible();
  await page.keyboard.press("Escape");

  const left = (await column(page, 1).boundingBox())!;
  const right = (await column(page, 2).boundingBox())!;
  await page.mouse.move(left.x + 6, left.y + 3);
  await page.mouse.down();
  await page.mouse.move(left.x + 20, left.y + 3, { steps: 4 });
  await page.mouse.move(right.x + right.width - 4, right.y + 3, { steps: 8 });
  await page.mouse.up();
  await expect(editor.locator("td.dd-tc-selected")).toHaveCount(8);
  await expect(page.getByRole("menuitem", { name: "Delete 2 columns" })).toBeVisible();
});

test("@live @smoke @tablecontrols: dragging from cell to cell picks a block of cells and lights it up", async ({
  page,
}) => {
  test.setTimeout(90000);
  const editor = await openTable(page);
  const topRight = (await editor.locator("tr").nth(2).locator("td").nth(2).boundingBox())!;
  const bottomRight = (await editor.locator("tr").nth(3).locator("td").nth(2).boundingBox())!;
  await page.mouse.move(topRight.x + 8, topRight.y + topRight.height / 2);
  await page.mouse.down();
  await page.mouse.move(topRight.x + 12, topRight.y + topRight.height / 2 + 6, { steps: 3 });
  await page.mouse.move(bottomRight.x + bottomRight.width - 6, bottomRight.y + bottomRight.height / 2, { steps: 8 });
  await page.mouse.up();

  const lit = editor.locator("td.dd-tc-selected");
  await expect(lit).toHaveCount(2);
  await expect(editor.locator("tr").nth(3).locator("td").first()).not.toHaveClass(/dd-tc-selected/);
  // No text is picked in reading order, so the cell on the left stays unmarked.
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");

  await editor.locator("td").first().click();
  await expect(lit).toHaveCount(0);
});

test("@live @smoke @tablecontrols: Backspace empties the picked cells and keeps the table", async ({
  page,
}) => {
  test.setTimeout(90000);
  const editor = await openTable(page);
  const top = (await editor.locator("tr").nth(2).locator("td").nth(1).boundingBox())!;
  const bottom = (await editor.locator("tr").nth(3).locator("td").nth(2).boundingBox())!;
  await page.mouse.move(top.x + 8, top.y + top.height / 2);
  await page.mouse.down();
  await page.mouse.move(top.x + 14, top.y + top.height / 2 + 6, { steps: 3 });
  await page.mouse.move(bottom.x + bottom.width - 6, bottom.y + bottom.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(editor.locator("td.dd-tc-selected")).toHaveCount(4);

  await page.keyboard.press("Backspace");
  const cells = (row: number) =>
    editor.locator("tr").nth(row).locator("td").evaluateAll((tds) =>
      tds.map((td) => (td as HTMLElement).innerText.trim()),
    );
  expect(await cells(2)).toEqual(["URL", "", ""]);
  expect(await cells(3)).toEqual(["Auth", "", ""]);
  expect(await cells(0)).toEqual(["Key", "Value", "Note"]);
  expect(await cells(1)).toEqual(["Method", "GET", "a"]);

  // A column picked with its bar is emptied from the menu too.
  await column(page, 1).click();
  await page.keyboard.press("Delete");
  expect(await cells(0)).toEqual(["", "Value", "Note"]);
  expect(await cells(1)).toEqual(["", "GET", "a"]);
  await expect(editor.locator("tr")).toHaveCount(4);
  await expectNoInternalMessage(page);
});

test("@live @smoke @tablecontrols: the stretch edges are out of the way while several rows, columns or cells are picked", async ({
  page,
}) => {
  test.setTimeout(90000);
  const editor = await openTable(page);
  await expect(page.locator(".dd-tc-resize")).not.toHaveCount(0);

  await column(page, 1).click();
  await expect(page.locator(".dd-tc-resize")).not.toHaveCount(0);
  await column(page, 2).click({ modifiers: ["Shift"] });
  await expect(page.locator(".dd-tc-resize")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await editor.locator("td").nth(4).click();
  await expect(page.locator(".dd-tc-resize")).not.toHaveCount(0);
  const top = (await editor.locator("tr").nth(2).locator("td").nth(1).boundingBox())!;
  const bottom = (await editor.locator("tr").nth(3).locator("td").nth(2).boundingBox())!;
  await page.mouse.move(top.x + 8, top.y + top.height / 2);
  await page.mouse.down();
  await page.mouse.move(top.x + 14, top.y + top.height / 2 + 6, { steps: 3 });
  await page.mouse.move(bottom.x + bottom.width - 6, bottom.y + bottom.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".dd-tc-resize")).toHaveCount(0);
});
