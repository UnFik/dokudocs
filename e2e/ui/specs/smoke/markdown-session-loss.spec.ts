import { test, expect, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const apiURL = process.env.API_URL ?? "http://localhost:8080";
const tokenCookie = "thisisjustarandomstring";

type Session = {
  page: Page;
  token: string;
  setLink: (mode: "up" | "down" | "unauthorized") => void;
};

async function signIn(
  browser: Browser,
  baseURL: string,
  email: string,
  password: string,
): Promise<Session> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname === "/");
  const cookie = (await context.cookies()).find((c) => c.name === tokenCookie);
  expect(cookie).toBeDefined();

  // The routed WebSocket lets the test cut the link, or answer the next
  // connection as a server that rejects the token.
  let mode: "up" | "down" | "unauthorized" = "up";
  const open: { close: () => void }[] = [];
  await page.routeWebSocket(/\/collaboration\//, (ws) => {
    if (mode === "down") {
      ws.close();
      return;
    }
    if (mode === "unauthorized") {
      ws.onMessage(() => {
        ws.send(JSON.stringify({ type: "error", code: "unauthorized" }));
      });
      return;
    }
    ws.connectToServer();
    open.push(ws);
  });
  return {
    page,
    token: cookie!.value,
    setLink(next) {
      mode = next;
      if (next !== "up") for (const ws of open.splice(0)) ws.close();
    },
  };
}

async function register() {
  const suffix = randomUUID().slice(0, 8);
  const user = {
    email: `loss-${suffix}@dokudocs.test`,
    password: "password12345678",
    fullName: `Session Loss ${suffix}`,
  };
  const response = await fetch(`${apiURL}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(user),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as {
    data: { accessToken: string; user: { id: string } };
  };
  return { ...user, token: body.data.accessToken, id: body.data.user.id };
}

async function createDocument(owner: { token: string }, workspaceName: string) {
  const headers = {
    Authorization: `Bearer ${owner.token}`,
    "Content-Type": "application/json",
  };
  const workspace = await fetch(`${apiURL}/api/v1/workspaces`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: workspaceName, plan: "Pro Workspace" }),
  });
  expect(workspace.status).toBe(201);
  const workspaceID = ((await workspace.json()) as { data: { id: string } })
    .data.id;
  const documentID = randomUUID();
  const root = randomUUID();
  const paragraph = randomUUID();
  const run = randomUUID();
  const node = (
    nodeID: string,
    parentID: string | null,
    siblingOrder: number,
    type: string,
    content = "",
  ) => ({ nodeID, parentID, siblingOrder, type, content, attributes: {} });
  const created = await fetch(`${apiURL}/api/v1/documents`, {
    method: "POST",
    headers: {
      ...headers,
      "X-Workspace-Id": workspaceID,
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({
      title: `Session loss ${Date.now()}`,
      type: "markdown",
      isDraft: true,
      initialBody: {
        documentID,
        bodySchemaVersion: 1,
        rootNodeID: root,
        nodes: [
          node(root, null, 1, "document"),
          node(paragraph, root, 1, "paragraph"),
          node(run, paragraph, 1, "run", "shared text"),
        ],
      },
    }),
  });
  expect(created.status).toBe(201);
  return { workspaceID, documentID, headers: { ...headers, "X-Workspace-Id": workspaceID } };
}

async function openEditor(page: Page, documentID: string, workspaceID: string) {
  await page.goto(`/docs/${documentID}?workspaceId=${workspaceID}`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.locator('.ProseMirror[contenteditable="true"]');
  await expect(editor).toBeVisible();
  await expect(page.getByRole("status").first()).toContainText("Synced");
  return editor;
}

async function pendingUpdateCount(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open("dokudocs-collaboration");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("pending-updates")) {
            db.close();
            resolve(0);
            return;
          }
          const count = db
            .transaction("pending-updates", "readonly")
            .objectStore("pending-updates")
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

async function typeOffline(session: Session, editor: ReturnType<Page["locator"]>) {
  session.setLink("down");
  await expect(session.page.getByRole("status").first()).toContainText("Offline");
  await editor.click();
  await session.page.keyboard.press("Control+Home");
  await session.page.keyboard.type("PENDING ");
  await expect.poll(() => pendingUpdateCount(session.page)).toBeGreaterThan(0);
}

async function sharedDocument(browser: Browser, baseURL: string) {
  const owner = await register();
  const member = await register();
  const doc = await createDocument(owner, `Session loss ${Date.now()}`);
  const invite = await fetch(
    `${apiURL}/api/v1/workspaces/${doc.workspaceID}/invites`,
    {
      method: "POST",
      headers: doc.headers,
      body: JSON.stringify({ email: member.email, role: "member" }),
    },
  );
  expect(invite.status).toBe(201);
  const grant = await fetch(`${apiURL}/api/v1/documents/${doc.documentID}/accesses`, {
    method: "POST",
    headers: doc.headers,
    body: JSON.stringify({ email: member.email, level: "edit" }),
  });
  expect(grant.status).toBe(201);
  const session = await signIn(browser, baseURL, member.email, member.password);
  return { owner, member, doc, session };
}

test("@live @smoke: access revoked while offline discards the pending edit on reconnect", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const baseURL = test.info().project.use.baseURL!;
  const { member, doc, session } = await sharedDocument(browser, baseURL);
  const editor = await openEditor(session.page, doc.documentID, doc.workspaceID);
  await typeOffline(session, editor);

  const revoke = await fetch(
    `${apiURL}/api/v1/documents/${doc.documentID}/accesses/${member.id}`,
    { method: "DELETE", headers: doc.headers },
  );
  expect(revoke.status).toBe(200);
  const removed = await fetch(
    `${apiURL}/api/v1/workspaces/${doc.workspaceID}/members/${member.id}`,
    { method: "DELETE", headers: doc.headers },
  );
  expect(removed.status).toBe(200);

  session.setLink("up");
  await expect(
    session.page.getByText("Read access is no longer available."),
  ).toBeVisible({ timeout: 30000 });
  await expect.poll(() => pendingUpdateCount(session.page)).toBe(0);

  const stored = await fetch(`${apiURL}/api/v1/documents/${doc.documentID}/body`, {
    headers: doc.headers,
  });
  expect(JSON.stringify(await stored.json())).not.toContain("PENDING");
});

test("@live @smoke: a rejected token keeps the pending edit and asks the user to sign in again", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const baseURL = test.info().project.use.baseURL!;
  const { doc, session } = await sharedDocument(browser, baseURL);
  const editor = await openEditor(session.page, doc.documentID, doc.workspaceID);
  await typeOffline(session, editor);

  session.setLink("unauthorized");
  await expect(
    session.page.getByText("Sign in again to load this document."),
  ).toBeVisible({ timeout: 30000 });
  expect(await pendingUpdateCount(session.page)).toBeGreaterThan(0);
});

// Records current behavior, which differs from ADR 0007 (logout is supposed to
// clear pending edits after offering sync or export). See
// docs/research/dokudocs-g1-ha-resilience.md before changing this assertion.
test("@live @smoke: logout with a pending edit currently leaves it in local storage", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const baseURL = test.info().project.use.baseURL!;
  const { doc, session } = await sharedDocument(browser, baseURL);
  const editor = await openEditor(session.page, doc.documentID, doc.workspaceID);
  await typeOffline(session, editor);

  await session.page.goto("/");
  const userButton = session.page
    .locator('[data-sidebar="footer"] button')
    .last();
  await userButton.click();
  await session.page.getByRole("menuitem", { name: /logout/i }).click();
  await session.page.getByRole("button", { name: /^sign out$/i }).click();
  await session.page.waitForURL(/sign-in/);

  expect(await pendingUpdateCount(session.page)).toBeGreaterThan(0);
});
