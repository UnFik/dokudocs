import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function pendingMoveCount(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open("dokudocs-collaboration");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("pending-move-commands")) {
            db.close();
            resolve(0);
            return;
          }
          const count = db
            .transaction("pending-move-commands", "readonly")
            .objectStore("pending-move-commands")
            .count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result);
          };
          count.onerror = () => reject(count.error);
        };
      }),
  );
}

test("@live @smoke: Markdown edits and structural commands sync every client", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  const suffix = `${Date.now()}`;
  const workspaceName = `Collaboration workspace ${suffix}`;
  const documentTitle = `Collaboration doc ${suffix}`;
  const marker = `Durable browser edit ${suffix}`;

  await page.goto("/sign-in");
  await page.locator('input[name="email"]').fill("admin@example.com");
  await page.locator('input[name="password"]').fill("password123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname === "/");

  await page
    .getByRole("button", { name: /workspace/i })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Create Workspace" }).click();
  await page.getByLabel("Workspace Name").fill(workspaceName);
  const workspaceResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "POST" &&
      url.pathname === "/api/v1/workspaces"
    );
  });
  await page.getByRole("button", { name: "Create Workspace" }).click();
  const workspaceResult = await workspaceResponse;
  expect(workspaceResult.ok()).toBe(true);
  const workspaceID = (
    (await workspaceResult.json()) as {
      data: { id: string };
    }
  ).data.id;
  await expect(
    page.getByRole("button", { name: new RegExp(workspaceName) }),
  ).toBeVisible();

  const documentID = randomUUID();
  const rootNodeID = randomUUID();
  const paragraphNodeID = randomUUID();
  const runNodeID = randomUUID();
  const deletableParagraphNodeID = randomUUID();
  const deletableRunNodeID = randomUUID();
  const accessCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "thisisjustarandomstring",
  );
  expect(accessCookie).toBeDefined();
  const apiURL = process.env.API_URL ?? "http://localhost:8080";
  const createDocumentResponse = await page.request.post(
    `${apiURL}/api/v1/documents`,
    {
      headers: {
        Authorization: `Bearer ${accessCookie!.value}`,
        "X-Workspace-Id": workspaceID,
        "Idempotency-Key": randomUUID(),
      },
      data: {
        title: documentTitle,
        type: "markdown",
        isDraft: true,
        initialBody: {
          documentID,
          bodySchemaVersion: 1,
          rootNodeID,
          nodes: [
            {
              nodeID: rootNodeID,
              parentID: null,
              siblingOrder: 1,
              type: "document",
              content: "",
              attributes: {},
            },
            {
              nodeID: paragraphNodeID,
              parentID: rootNodeID,
              siblingOrder: 1,
              type: "paragraph",
              content: "",
              attributes: {},
            },
            {
              nodeID: runNodeID,
              parentID: paragraphNodeID,
              siblingOrder: 1,
              type: "run",
              content: "Initial body",
              attributes: {},
            },
            {
              nodeID: deletableParagraphNodeID,
              parentID: rootNodeID,
              siblingOrder: 2,
              type: "paragraph",
              content: "",
              attributes: {},
            },
            {
              nodeID: deletableRunNodeID,
              parentID: deletableParagraphNodeID,
              siblingOrder: 1,
              type: "run",
              content: "Delete this block",
              attributes: {},
            },
          ],
        },
      },
    },
  );
  expect(createDocumentResponse.status()).toBe(201);

  await page.goto(`/docs/${documentID}`);

  const documentURL = page.url();
  const editor = page.locator('.ProseMirror[contenteditable="true"]');
  await expect(editor).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Synced");

  await page.getByRole("tab", { name: "Edit", exact: true }).click();
  await expect(editor).toHaveAttribute("contenteditable", "true");

  const storageState = await page.context().storageState();
  const secondContext = await browser.newContext({ storageState });
  const secondPage = await secondContext.newPage();
  await secondPage.goto(documentURL);

  const secondEditor = secondPage.locator(
    '.ProseMirror[contenteditable="true"]',
  );
  await expect(secondEditor).toBeVisible();
  await expect(secondPage.getByRole("status")).toContainText("Synced");

  await page.getByText("Initial body", { exact: true }).click();
  await editor.press("End");
  await page.keyboard.type(marker);

  await expect(editor).toContainText(marker);
  await expect(secondEditor).toContainText(marker);

  const reconnectContext = await browser.newContext({ storageState });
  const reconnectPage = await reconnectContext.newPage();
  await reconnectPage.goto(documentURL);
  const reconnectEditor = reconnectPage.locator(
    '.ProseMirror[contenteditable="true"]',
  );
  await expect(reconnectEditor).toBeVisible();
  await expect(reconnectPage.getByRole("status")).toContainText("Synced");
  await expect(reconnectEditor).toContainText(marker);

  await reconnectContext.close();

  const bodyHeaders = {
    Authorization: `Bearer ${accessCookie!.value}`,
    "X-Workspace-Id": workspaceID,
  };
  const beforeMoveResponse = await page.request.get(
    `${apiURL}/api/v1/documents/${documentID}/body`,
    { headers: bodyHeaders },
  );
  expect(beforeMoveResponse.status()).toBe(200);
  const beforeMove = (await beforeMoveResponse.json()).data as {
    bodyVersion: number;
    bodyEpoch: number;
  };
  const moveResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "POST" &&
      url.pathname === `/api/v1/documents/${documentID}/body/move`
    );
  });
  await editor.locator("p").filter({ hasText: "Initial body" }).click();
  await page.keyboard.press("Alt+ArrowDown");
  const moveResponse = await moveResponsePromise;
  expect(moveResponse.status()).toBe(200);
  const moveReceipt = (await moveResponse.json()).data as {
    commandID: string;
    bodyVersion: number;
    bodyEpoch: number;
    changed: boolean;
  };
  expect(moveReceipt).toMatchObject({
    bodyVersion: beforeMove.bodyVersion + 1,
    bodyEpoch: beforeMove.bodyEpoch + 1,
    changed: true,
  });
  const moveCommand = moveResponse.request().postDataJSON();
  expect(moveCommand).toMatchObject({
    bodyEpoch: beforeMove.bodyEpoch,
    bodySchemaVersion: 1,
    nodeID: paragraphNodeID,
    targetParentID: rootNodeID,
    beforeNodeID: null,
  });
  expect(moveReceipt.commandID).toBe(moveCommand.commandID);

  const retryMoveResponse = await page.request.post(
    `${apiURL}/api/v1/documents/${documentID}/body/move`,
    { headers: bodyHeaders, data: moveCommand },
  );
  expect(retryMoveResponse.status()).toBe(200);
  expect((await retryMoveResponse.json()).data).toEqual(moveReceipt);

  await expect(editor.locator("p").nth(0)).toContainText("Delete this block");
  await expect(editor.locator("p").nth(1)).toContainText(marker);
  await expect(secondEditor.locator("p").nth(0)).toContainText(
    "Delete this block",
  );
  await expect(secondEditor.locator("p").nth(1)).toContainText(marker);

  await secondPage.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() =>
      secondPage.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
  await secondContext.setOffline(true);
  await secondEditor
    .locator("p")
    .filter({ hasText: "Delete this block" })
    .click();
  await secondPage.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => pendingMoveCount(secondPage)).toBe(1);

  await secondPage.reload();
  await expect(
    secondPage.locator('.ProseMirror[contenteditable="true"]'),
  ).toBeVisible();
  await expect.poll(() => pendingMoveCount(secondPage)).toBe(1);

  const offlineMoveResponsePromise = secondPage.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "POST" &&
      url.pathname === `/api/v1/documents/${documentID}/body/move`
    );
  });
  await secondContext.setOffline(false);
  const offlineMoveResponse = await offlineMoveResponsePromise;
  expect(offlineMoveResponse.status()).toBe(200);
  const offlineMoveReceipt = (await offlineMoveResponse.json()).data as {
    bodyVersion: number;
    bodyEpoch: number;
    changed: boolean;
  };
  expect(offlineMoveReceipt).toMatchObject({
    bodyVersion: moveReceipt.bodyVersion + 1,
    bodyEpoch: moveReceipt.bodyEpoch + 1,
    changed: true,
  });
  await expect(editor.locator("p").nth(0)).toContainText(marker);
  await expect(editor.locator("p").nth(1)).toContainText("Delete this block");
  await expect(secondEditor.locator("p").nth(0)).toContainText(marker);
  await expect(secondEditor.locator("p").nth(1)).toContainText(
    "Delete this block",
  );

  const beforeDeleteResponse = await page.request.get(
    `${apiURL}/api/v1/documents/${documentID}/body`,
    { headers: bodyHeaders },
  );
  expect(beforeDeleteResponse.status()).toBe(200);
  const beforeDelete = (await beforeDeleteResponse.json()).data as {
    bodyVersion: number;
    bodyEpoch: number;
    nodes: { nodeID: string; type: string; content: string }[];
  };
  expect(beforeDelete.nodes).toContainEqual(
    expect.objectContaining({
      nodeID: deletableParagraphNodeID,
      type: "paragraph",
    }),
  );
  expect(beforeDelete.nodes).toContainEqual(
    expect.objectContaining({
      nodeID: deletableRunNodeID,
      content: "Delete this block",
    }),
  );
  const deleteResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "POST" &&
      url.pathname === `/api/v1/documents/${documentID}/body/delete`
    );
  });
  await editor.locator("p").filter({ hasText: "Delete this block" }).click({
    clickCount: 3,
  });
  await page.keyboard.press("Backspace");
  const deleteResponse = await deleteResponsePromise;
  expect(deleteResponse.status()).toBe(200);
  const deleteResult = (await deleteResponse.json()).data as {
    commandID: string;
    bodyVersion: number;
    bodyEpoch: number;
    nodeID: string;
    changed: boolean;
  };
  expect(deleteResult.bodyEpoch).toBe(4);
  expect(deleteResult.nodeID, JSON.stringify(beforeDelete.nodes)).toBe(
    deletableParagraphNodeID,
  );
  expect(deleteResult.changed).toBe(true);
  expect(deleteResult.commandID).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  expect(deleteResult.bodyVersion).toBe(beforeDelete.bodyVersion + 1);
  const afterDeleteResponse = await page.request.get(
    `${apiURL}/api/v1/documents/${documentID}/body`,
    { headers: bodyHeaders },
  );
  expect(afterDeleteResponse.status()).toBe(200);
  const afterDelete = (await afterDeleteResponse.json()).data as {
    nodes: { nodeID: string }[];
  };
  expect(
    afterDelete.nodes.some((node) => node.nodeID === deletableParagraphNodeID),
  ).toBe(false);
  expect(
    afterDelete.nodes.some((node) => node.nodeID === deletableRunNodeID),
  ).toBe(false);
  await expect(editor).not.toContainText("Delete this block", {
    timeout: 20000,
  });
  await expect(secondEditor).not.toContainText("Delete this block", {
    timeout: 20000,
  });
  await expect(editor).toContainText(marker);
  await expect(secondEditor).toContainText(marker);
  await expect(page.getByRole("status")).toContainText("Synced");
  await expect(secondPage.getByRole("status")).toContainText("Synced");
  await secondContext.close();
});
