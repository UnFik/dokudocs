import { test, expect, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const apiURL = process.env.API_URL ?? "http://localhost:8080";

type Client = {
  page: Page;
  setOffline: (offline: boolean) => void;
};

async function openClient(
  browser: Browser,
  baseURL: string,
): Promise<Client & { token: string }> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.locator('input[name="email"]').fill("admin@example.com");
  await page.locator('input[name="password"]').fill("password123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname === "/");
  const cookie = (await context.cookies()).find(
    (c) => c.name === "thisisjustarandomstring",
  );
  expect(cookie).toBeDefined();

  // A routed WebSocket lets the test cut and restore the collaboration link;
  // context.setOffline does not close sockets that are already open.
  let offline = false;
  const sockets: { close: () => void }[] = [];
  await page.routeWebSocket(/\/collaboration\//, (ws) => {
    if (offline) {
      ws.close();
      return;
    }
    ws.connectToServer();
    sockets.push(ws);
  });
  return {
    page,
    token: cookie!.value,
    setOffline(next) {
      offline = next;
      if (next) for (const ws of sockets.splice(0)) ws.close();
    },
  };
}

async function createDocument(
  page: Page,
  token: string,
  thirdParagraph = false,
  fourthParagraph = false,
) {
  const workspaceResponse = await page.request.post(
    `${apiURL}/api/v1/workspaces`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: `Rebase ${Date.now()}`, plan: "Pro Workspace" },
    },
  );
  expect(workspaceResponse.status()).toBe(201);
  const workspaceID = (
    (await workspaceResponse.json()) as { data: { id: string } }
  ).data.id;
  const documentID = randomUUID();
  const ids = {
    root: randomUUID(),
    p1: randomUUID(),
    r1: randomUUID(),
    p2: randomUUID(),
    r2: randomUUID(),
    p3: randomUUID(),
    r3: randomUUID(),
    p4: randomUUID(),
    r4: randomUUID(),
  };
  const node = (
    nodeID: string,
    parentID: string | null,
    siblingOrder: number,
    type: string,
    content = "",
  ) => ({ nodeID, parentID, siblingOrder, type, content, attributes: {} });
  const created = await page.request.post(`${apiURL}/api/v1/documents`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Workspace-Id": workspaceID,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      title: `Rebase doc ${Date.now()}`,
      type: "markdown",
      isDraft: true,
      initialBody: {
        documentID,
        bodySchemaVersion: 1,
        rootNodeID: ids.root,
        nodes: [
          node(ids.root, null, 1, "document"),
          node(ids.p1, ids.root, 1, "paragraph"),
          node(ids.r1, ids.p1, 1, "run", "first"),
          node(ids.p2, ids.root, 2, "paragraph"),
          node(ids.r2, ids.p2, 1, "run", "second"),
          ...(thirdParagraph
            ? [
                node(ids.p3, ids.root, 3, "paragraph"),
                node(ids.r3, ids.p3, 1, "run", "third"),
              ]
            : []),
          ...(fourthParagraph
            ? [
                node(ids.p4, ids.root, 4, "paragraph"),
                node(ids.r4, ids.p4, 1, "run", "fourth"),
              ]
            : []),
        ],
      },
    },
  });
  expect(created.status()).toBe(201);
  return { documentID, workspaceID, ids };
}

async function deleteBlock(
  page: Page,
  token: string,
  doc: { documentID: string; workspaceID: string },
  nodeID: string,
) {
  const response = await page.request.post(
    `${apiURL}/api/v1/documents/${doc.documentID}/body/delete`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Workspace-Id": doc.workspaceID,
      },
      data: {
        commandID: randomUUID(),
        bodyEpoch: 1,
        bodySchemaVersion: 1,
        nodeID,
      },
    },
  );
  expect(response.status()).toBe(200);
}

async function openEditor(page: Page, documentID: string, workspaceID: string) {
  await page.goto(`/docs/${documentID}?workspaceId=${workspaceID}`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.locator('.ProseMirror[contenteditable="true"]');
  await expect(editor).toBeVisible();
  await expect(page.getByRole("status").first()).toContainText("Synced");
  return editor;
}

async function pendingCommandCount(
  page: Page,
  storeName: "pending-delete-commands" | "pending-move-commands",
) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open("dokudocs-collaboration");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.close();
            resolve(0);
            return;
          }
          const count = db
            .transaction(storeName, "readonly")
            .objectStore(storeName)
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

test("@live @smoke: offline edit merges after another user deletes an unrelated block", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const baseURL = test.info().project.use.baseURL!;
  const a = await openClient(browser, baseURL);
  const b = await openClient(browser, baseURL);
  const doc = await createDocument(a.page, a.token);
  const editorA = await openEditor(a.page, doc.documentID, doc.workspaceID);
  const editorB = await openEditor(b.page, doc.documentID, doc.workspaceID);

  b.setOffline(true);
  await expect(b.page.getByRole("status").first()).toContainText("Offline");
  await editorB.click();
  await b.page.keyboard.press("Control+Home");
  await b.page.keyboard.type("OFFLINE ");

  await deleteBlock(a.page, a.token, doc, doc.ids.p2);

  b.setOffline(false);
  await expect(b.page.getByRole("status").first()).toContainText("Synced", {
    timeout: 30000,
  });
  await expect(b.page.getByText("Local changes were not applied")).toHaveCount(
    0,
  );
  await expect(
    b.page.getByRole("button", { name: /Export local changes/ }),
  ).toHaveCount(0);
  const editableB = b.page.locator('.ProseMirror[contenteditable="true"]');
  await expect(editableB).toContainText("OFFLINE first");
  await expect(editableB).not.toContainText("second");

  await expect(editorA).toContainText("OFFLINE first", { timeout: 15000 });
  await expect(editorA).not.toContainText("second");

  const persisted = await a.page.request.get(
    `${apiURL}/api/v1/documents/${doc.documentID}/body`,
    {
      headers: {
        Authorization: `Bearer ${a.token}`,
        "X-Workspace-Id": doc.workspaceID,
      },
    },
  );
  const stored = (await persisted.json()) as {
    data: { nodes: Array<{ content: string }> };
  };
  expect(stored.data.nodes.map((n) => n.content)).toContain("OFFLINE first");
});

test("@live @smoke: offline edit to a block deleted by another user stays available for review", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const baseURL = test.info().project.use.baseURL!;
  const a = await openClient(browser, baseURL);
  const b = await openClient(browser, baseURL);
  const doc = await createDocument(a.page, a.token);
  await openEditor(a.page, doc.documentID, doc.workspaceID);
  const editorB = await openEditor(b.page, doc.documentID, doc.workspaceID);

  b.setOffline(true);
  await expect(b.page.getByRole("status").first()).toContainText("Offline");
  await editorB.click();
  await b.page.keyboard.press("Control+Home");
  await b.page.keyboard.type("LOST? ");

  await deleteBlock(a.page, a.token, doc, doc.ids.p1);

  b.setOffline(false);
  await expect(
    b.page.getByRole("button", { name: /Export local changes/ }),
  ).toBeVisible({ timeout: 30000 });
});

test("@live @smoke: an offline block move is applied after another user deletes a different block", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const baseURL = test.info().project.use.baseURL!;
  const a = await openClient(browser, baseURL);
  const b = await openClient(browser, baseURL);
  const doc = await createDocument(a.page, a.token, true, true);
  const editorA = await openEditor(a.page, doc.documentID, doc.workspaceID);
  const editorB = await openEditor(b.page, doc.documentID, doc.workspaceID);

  b.setOffline(true);
  await expect(b.page.getByRole("status").first()).toContainText("Offline");
  await editorB.locator("p").filter({ hasText: "first" }).click();
  await b.page.keyboard.press("Alt+ArrowDown");
  await expect
    .poll(() => pendingCommandCount(b.page, "pending-move-commands"))
    .toBe(1);

  await deleteBlock(a.page, a.token, doc, doc.ids.p4);

  const moveResponses: number[] = [];
  b.page.on("response", (response) => {
    if (
      response.request().method() === "POST" &&
      new URL(response.url()).pathname ===
        `/api/v1/documents/${doc.documentID}/body/move`
    )
      moveResponses.push(response.status());
  });
  b.setOffline(false);
  await expect.poll(() => moveResponses.length).toBe(2);
  expect(moveResponses, "MoveNode response sequence").toEqual([409, 200]);
  await expect(b.page.getByRole("status").first()).toContainText("Synced", {
    timeout: 30000,
  });
  await expect(
    b.page.getByRole("button", { name: /Export local changes/ }),
  ).toHaveCount(0);

  const persisted = await a.page.request.get(
    `${apiURL}/api/v1/documents/${doc.documentID}/body`,
    {
      headers: {
        Authorization: `Bearer ${a.token}`,
        "X-Workspace-Id": doc.workspaceID,
      },
    },
  );
  const stored = (await persisted.json()) as {
    data: {
      nodes: Array<{
        nodeID: string;
        parentID: string | null;
        siblingOrder: number;
      }>;
    };
  };
  const rootID = stored.data.nodes.find(
    (node) => node.parentID === null,
  )!.nodeID;
  const rootChildren = stored.data.nodes
    .filter((node) => node.parentID === rootID)
    .sort((x, y) => x.siblingOrder - y.siblingOrder)
    .map((node) => node.nodeID);
  expect(rootChildren).toEqual([doc.ids.p2, doc.ids.p1, doc.ids.p3]);

  const paragraphsB = b.page.locator('.ProseMirror[contenteditable="true"] p');
  await expect(paragraphsB).toHaveText(["second", "first", "third"], {
    timeout: 15000,
  });
  await expect(editorA.locator("p")).toHaveText(["second", "first", "third"], {
    timeout: 15000,
  });
});

test("@live @smoke: an offline block move stays for review if its anchor is deleted", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const baseURL = test.info().project.use.baseURL!;
  const a = await openClient(browser, baseURL);
  const b = await openClient(browser, baseURL);
  const doc = await createDocument(a.page, a.token, true, true);
  await openEditor(a.page, doc.documentID, doc.workspaceID);
  const editorB = await openEditor(b.page, doc.documentID, doc.workspaceID);

  b.setOffline(true);
  await expect(b.page.getByRole("status").first()).toContainText("Offline");
  await editorB.locator("p").filter({ hasText: "first" }).click();
  await b.page.keyboard.press("Alt+ArrowDown");
  await expect
    .poll(() => pendingCommandCount(b.page, "pending-move-commands"))
    .toBe(1);

  await deleteBlock(a.page, a.token, doc, doc.ids.p3);

  const moveResponses: Array<{ status: number; commandID: string }> = [];
  b.page.on("response", (response) => {
    if (
      response.request().method() === "POST" &&
      new URL(response.url()).pathname ===
        `/api/v1/documents/${doc.documentID}/body/move`
    ) {
      moveResponses.push({
        status: response.status(),
        commandID: response.request().postDataJSON().commandID,
      });
    }
  });
  b.setOffline(false);
  await expect(b.page.getByRole("status").first()).toContainText(
    "recovery-required",
    { timeout: 30000 },
  );
  expect(moveResponses.length).toBeGreaterThan(0);
  expect(moveResponses.every(({ status }) => status === 409)).toBe(true);
  expect(new Set(moveResponses.map(({ commandID }) => commandID)).size).toBe(1);
  await expect
    .poll(() => pendingCommandCount(b.page, "pending-move-commands"))
    .toBe(1);
  await expect(
    b.page.getByRole("button", { name: /Export local changes/ }),
  ).toBeVisible();

  const persisted = await a.page.request.get(
    `${apiURL}/api/v1/documents/${doc.documentID}/body`,
    {
      headers: {
        Authorization: `Bearer ${a.token}`,
        "X-Workspace-Id": doc.workspaceID,
      },
    },
  );
  const stored = (await persisted.json()) as {
    data: {
      nodes: Array<{
        nodeID: string;
        parentID: string | null;
        siblingOrder: number;
      }>;
    };
  };
  const rootID = stored.data.nodes.find(
    (node) => node.parentID === null,
  )!.nodeID;
  const rootChildren = stored.data.nodes
    .filter((node) => node.parentID === rootID)
    .sort((x, y) => x.siblingOrder - y.siblingOrder)
    .map((node) => node.nodeID);
  expect(rootChildren).toEqual([doc.ids.p1, doc.ids.p2, doc.ids.p4]);
});

test("@live @smoke: an offline DeleteNode is replayed after an unrelated deletion", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const baseURL = test.info().project.use.baseURL!;
  const a = await openClient(browser, baseURL);
  const b = await openClient(browser, baseURL);
  const doc = await createDocument(a.page, a.token, true);
  const editorA = await openEditor(a.page, doc.documentID, doc.workspaceID);
  const editorB = await openEditor(b.page, doc.documentID, doc.workspaceID);

  b.setOffline(true);
  await expect(b.page.getByRole("status").first()).toContainText("Offline");
  await editorB.locator("p").filter({ hasText: "second" }).click({
    clickCount: 3,
  });
  await b.page.keyboard.press("Backspace");
  await expect
    .poll(() => pendingCommandCount(b.page, "pending-delete-commands"))
    .toBe(1);

  await deleteBlock(a.page, a.token, doc, doc.ids.p3);

  const deleteResponses: Array<{ status: number; commandID: string }> = [];
  b.page.on("response", (response) => {
    if (
      response.request().method() === "POST" &&
      new URL(response.url()).pathname ===
        `/api/v1/documents/${doc.documentID}/body/delete`
    ) {
      deleteResponses.push({
        status: response.status(),
        commandID: response.request().postDataJSON().commandID,
      });
    }
  });
  b.setOffline(false);
  await expect.poll(() => deleteResponses.length).toBe(2);
  expect(deleteResponses.map(({ status }) => status)).toEqual([409, 200]);
  expect(deleteResponses[0]!.commandID).not.toBe(deleteResponses[1]!.commandID);
  await expect(b.page.getByRole("status").first()).toContainText("Synced", {
    timeout: 30000,
  });
  await expect
    .poll(() => pendingCommandCount(b.page, "pending-delete-commands"))
    .toBe(0);
  await expect(
    b.page.getByRole("button", { name: /Export local changes/ }),
  ).toHaveCount(0);
  await expect(editorA.locator("p")).toHaveText(["first"]);
  await expect(editorB.locator("p")).toHaveText(["first"]);

  const persisted = await a.page.request.get(
    `${apiURL}/api/v1/documents/${doc.documentID}/body`,
    {
      headers: {
        Authorization: `Bearer ${a.token}`,
        "X-Workspace-Id": doc.workspaceID,
      },
    },
  );
  const stored = (await persisted.json()) as {
    data: { nodes: Array<{ nodeID: string; parentID: string | null }> };
  };
  expect(stored.data.nodes.map((node) => node.nodeID)).toContain(doc.ids.p1);
  expect(stored.data.nodes.map((node) => node.nodeID)).not.toContain(
    doc.ids.p2,
  );
  expect(stored.data.nodes.map((node) => node.nodeID)).not.toContain(
    doc.ids.p3,
  );
});
