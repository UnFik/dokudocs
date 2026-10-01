import { test, expect, chromium, type Browser, type Page } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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


async function bodyNodes(
  page: Page,
  token: string,
  doc: { documentID: string; workspaceID: string },
) {
  const response = await page.request.get(
    `${apiURL}/api/v1/documents/${doc.documentID}/body`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Workspace-Id": doc.workspaceID,
      },
    },
  );
  return ((await response.json()) as {
    data: { nodes: Array<{ nodeID: string; content: string }> };
  }).data.nodes;
}

test("@live: partial rebase applies the clean offline edit and holds only the conflicting block", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const baseURL = test.info().project.use.baseURL!;
  const a = await openClient(browser, baseURL);
  const b = await openClient(browser, baseURL);
  const doc = await createDocument(a.page, a.token, true);
  const editorA = await openEditor(a.page, doc.documentID, doc.workspaceID);
  const editorB = await openEditor(b.page, doc.documentID, doc.workspaceID);

  b.setOffline(true);
  await expect(b.page.getByRole("status").first()).toContainText("Offline");
  await editorB.locator("p").filter({ hasText: "first" }).click();
  await b.page.keyboard.press("Home");
  await b.page.keyboard.type("MINE ");
  await editorB.locator("p").filter({ hasText: "second" }).click();
  await b.page.keyboard.press("Home");
  await b.page.keyboard.type("MY2 ");

  await editorA.locator("p").filter({ hasText: "second" }).click();
  await a.page.keyboard.press("Home");
  await a.page.keyboard.type("THEIRS ");
  await expect
    .poll(async () =>
      (await bodyNodes(a.page, a.token, doc)).map((n) => n.content),
    )
    .toContain("THEIRS second");
  await deleteBlock(a.page, a.token, doc, doc.ids.p3);

  b.setOffline(false);
  const panel = b.page.getByRole("region", { name: "Review local changes" });
  await expect(panel).toBeVisible({ timeout: 30000 });
  await expect(panel).toContainText("MY2 second");
  await expect(panel).toContainText("THEIRS second");
  await expect(panel).not.toContainText("MINE first");
  const editable = b.page.locator('.ProseMirror[contenteditable="true"]');
  await expect(editable).toContainText("MINE first");

  await panel.getByRole("button", { name: "Use my version" }).click();
  await expect(editable).toContainText("MY2 second", { timeout: 30000 });
  await expect
    .poll(async () =>
      (await bodyNodes(a.page, a.token, doc)).map((n) => n.content),
    )
    .toContain("MY2 second");
});

test("@live: an unsent offline edit survives a browser restart while the server changed", async () => {
  test.setTimeout(150000);
  const baseURL = test.info().project.use.baseURL!;
  const profile = mkdtempSync(join(tmpdir(), "dokudocs-restart-"));
  const launch = () =>
    chromium.launchPersistentContext(profile, { baseURL });

  const first = await launch();
  const page = await first.newPage();
  let socketsOffline = false;
  const liveSockets: { close: () => void }[] = [];
  await page.routeWebSocket(/\/collaboration\//, (ws) => {
    if (socketsOffline) {
      ws.close();
      return;
    }
    ws.connectToServer();
    liveSockets.push(ws);
  });
  await page.goto("/sign-in");
  await page.locator('input[name="email"]').fill("admin@example.com");
  await page.locator('input[name="password"]').fill("password123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname === "/");
  const token = (await first.cookies()).find(
    (c) => c.name === "thisisjustarandomstring",
  )!.value;
  const doc = await createDocument(page, token, true);
  const editor = await openEditor(page, doc.documentID, doc.workspaceID);
  await expect(editor).toContainText("first");

  socketsOffline = true;
  for (const ws of liveSockets.splice(0)) ws.close();
  await editor.locator("p").filter({ hasText: "first" }).click();
  await page.keyboard.press("Home");
  await page.keyboard.type("RESTART ");
  await expect
    .poll(async () => {
      const text = await page.getByRole("status").first().innerText();
      return text;
    })
    .toContain("Offline");
  await first.close();

  const server = await chromium.launch();
  const other = await server.newContext({ baseURL });
  const otherPage = await other.newPage();
  await otherPage.goto("/sign-in");
  await otherPage.locator('input[name="email"]').fill("admin@example.com");
  await otherPage.locator('input[name="password"]').fill("password123");
  await otherPage.getByRole("button", { name: /sign in/i }).click();
  await otherPage.waitForURL((url) => url.pathname === "/");
  await deleteBlock(otherPage, token, doc, doc.ids.p3);
  await server.close();

  const second = await launch();
  const reopened = await second.newPage();
  await reopened.goto(`/docs/${doc.documentID}?workspaceId=${doc.workspaceID}`);
  await reopened.getByRole("button", { name: "Edit", exact: true }).click();
  const editable = reopened.locator('.ProseMirror[contenteditable="true"]');
  await expect(editable).toContainText("RESTART first", { timeout: 30000 });
  await expect(reopened.getByRole("status").first()).toContainText("Synced", {
    timeout: 30000,
  });
  await expect
    .poll(async () =>
      (await bodyNodes(reopened, token, doc)).map((n) => n.content),
    )
    .toContain("RESTART first");
  await second.close();
});
