import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  appendLine,
  editorText,
  openSourceDocument,
} from "../../helpers/source-document";

// Two browsers on one DBML or Mermaid document (ADR 0033): edits reach the
// other, survive a reload and a new device, an offline edit merges on
// reconnect, and a restore replaces the record while unsent edits are kept
// apart as a recovery copy.
for (const [type, source, comment] of [
  ["dbdiagram", "Table users {\n  id int [pk]\n}", "//"],
  ["mermaid", "graph TD\n  A --> B", "%%"],
] as const) {
  test(`@live @smoke: ${type} source is edited together and kept in the database`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(150000);
    const { documentID, documentURL, api } = await openSourceDocument(page, type, source);
    await expect.poll(() => editorText(page)).toBe(source);

    const storageState = await page.context().storageState();
    const second = await browser.newContext({ storageState });
    const secondPage = await second.newPage();
    await secondPage.goto(documentURL);
    await expect(secondPage.getByText("Editing together")).toBeVisible({ timeout: 20000 });

    // Concurrent edits reach the other editor.
    await appendLine(page, `${comment} from A`);
    await expect.poll(() => editorText(secondPage)).toContain(`${comment} from A`);
    await appendLine(secondPage, `${comment} from B é😀`);
    await expect.poll(() => editorText(page)).toContain(`${comment} from B é😀`);

    // Saved means stored: the API returns the exact source, and a reload shows it.
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 20000 });
    const stored = async () =>
      ((await (await api(`/api/v1/documents/${documentID}`)).json()) as { data: { content: string } }).data.content;
    await expect.poll(stored, { timeout: 20000 }).toContain(`${comment} from B é😀`);
    await page.reload();
    await expect.poll(() => editorText(page), { timeout: 20000 }).toContain(`${comment} from B é😀`);

    // A device that never opened it reads the stored source.
    const fresh = await browser.newContext({ storageState });
    const freshPage = await fresh.newPage();
    await freshPage.goto(documentURL);
    await expect.poll(() => editorText(freshPage), { timeout: 20000 }).toContain(`${comment} from A`);
    await fresh.close();

    // An edit made offline is kept and merged on reconnect.
    await second.setOffline(true);
    await appendLine(secondPage, `${comment} offline`);
    await expect.poll(() => editorText(secondPage)).toContain(`${comment} offline`);
    expect(await editorText(page)).not.toContain(`${comment} offline`);
    await second.setOffline(false);
    await expect.poll(() => editorText(page), { timeout: 30000 }).toContain(`${comment} offline`);
    await expect.poll(stored, { timeout: 20000 }).toContain(`${comment} offline`);

    // Name a version, edit on, then restore it while B holds an unsent edit.
    const named = await api(`/api/v1/documents/${documentID}/revisions`, {
      method: "POST",
      data: { title: "Before restore" },
    });
    expect(named.status()).toBe(201);
    const namedID = ((await named.json()) as { data: { id: string } }).data.id;
    const namedSource = await stored();
    await appendLine(page, `${comment} after version`);
    await expect.poll(stored, { timeout: 20000 }).toContain(`${comment} after version`);
    await second.setOffline(true);
    await appendLine(secondPage, `${comment} never sent`);
    const restoreKey = randomUUID();
    const restore = () =>
      api(`/api/v1/documents/${documentID}/revisions/${namedID}/restore`, {
        method: "POST",
        headers: { "Idempotency-Key": restoreKey },
      });
    const first = await restore();
    expect(first.status()).toBe(200);
    // A retried restore is the same restore.
    const retried = await restore();
    expect(((await retried.json()) as { data: { revisionId: string } }).data.revisionId).toBe(
      ((await first.json()) as { data: { revisionId: string } }).data.revisionId,
    );

    // A, connected, reopens on the restored record.
    await expect.poll(() => editorText(page), { timeout: 30000 }).toBe(namedSource);

    // B reconnects: the restored record wins, and its unsent edit is kept apart.
    await second.setOffline(false);
    await expect.poll(() => editorText(secondPage), { timeout: 30000 }).toBe(namedSource);
    await expect(secondPage.getByText(/Edits this device had not sent/)).toBeVisible();
    expect(await stored()).toBe(namedSource);

    // Editing goes on together on the restored record.
    await appendLine(secondPage, `${comment} after restore`);
    await expect.poll(() => editorText(page), { timeout: 20000 }).toContain(`${comment} after restore`);
    await expect.poll(stored, { timeout: 20000 }).toContain(`${comment} after restore`);
    expect(await stored()).not.toContain(`${comment} never sent`);
    await second.close();
  });
}
