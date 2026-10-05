import { test, expect } from "@playwright/test";
import { openMarkdownDocument } from "../../helpers/markdown-document";

// Two browsers on one document: what one types, moves or deletes reaches the
// other, and what was edited offline is merged in when the connection returns.
test("@live @smoke: Markdown edits, moves and deletes sync every client", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const suffix = `${Date.now()}`;
  const marker = `Durable browser edit ${suffix}`;
  const { editor, documentURL } = await openMarkdownDocument(page, [
    "Initial body",
    "Delete this block",
  ]);

  const storageState = await page.context().storageState();
  const secondContext = await browser.newContext({ storageState });
  const secondPage = await secondContext.newPage();
  await secondPage.goto(documentURL);
  const secondEditor = secondPage.locator(".ProseMirror");
  await expect(secondEditor).toBeVisible();
  await expect(secondPage.getByRole("status")).toContainText("Synced");

  // Typing reaches the other client.
  await page.getByText("Initial body", { exact: true }).click();
  await editor.press("End");
  await page.keyboard.type(marker);
  await expect(secondEditor).toContainText(marker);

  // A client that opens later reads what the server stored.
  const reconnectContext = await browser.newContext({ storageState });
  const reconnectPage = await reconnectContext.newPage();
  await reconnectPage.goto(documentURL);
  const reconnectEditor = reconnectPage.locator(".ProseMirror");
  await expect(reconnectEditor).toContainText(marker, { timeout: 20000 });
  await reconnectContext.close();

  // Moving a block is an ordinary edit: it shows at once, here and there.
  await editor.locator("p").filter({ hasText: "Initial body" }).click();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(editor.locator("p").nth(0)).toContainText("Delete this block");
  await expect(editor.locator("p").nth(1)).toContainText(marker);
  await expect(secondEditor.locator("p").nth(0)).toContainText(
    "Delete this block",
  );
  await expect(secondEditor.locator("p").nth(1)).toContainText(marker);

  // Deleting a block does too, with no message and no waiting.
  await editor.locator("p").filter({ hasText: "Delete this block" }).click({
    clickCount: 3,
  });
  await page.keyboard.press("Backspace");
  await expect(editor).not.toContainText("Delete this block");
  await expect(secondEditor).not.toContainText("Delete this block");
  await expect(editor).toContainText(marker);

  // An edit made offline is kept on the device and merged on reconnect.
  await secondContext.setOffline(true);
  await secondPage.getByText(marker).click();
  await secondPage.keyboard.press("End");
  await secondPage.keyboard.type(" offline");
  await expect(secondEditor).toContainText("offline");
  await expect(editor).not.toContainText("offline");
  await secondContext.setOffline(false);
  await expect(editor).toContainText(`${marker} offline`, { timeout: 30000 });
  await expect(secondPage.getByRole("status")).toContainText("Synced", {
    timeout: 30000,
  });
  await secondContext.close();
});
