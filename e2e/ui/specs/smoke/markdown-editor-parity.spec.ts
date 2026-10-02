import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

// Gate G7 (#36): two clients edit tables through the toolbar, converge, and the
// server projection matches. Inline formats, nested lists and undo/redo are
// owned by #28-#30 and are listed as fixme until those land.
test("@live @smoke: table edits converge across two clients and persist", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const suffix = `${Date.now()}`;
  const workspaceName = `G7 workspace ${suffix}`;

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
  const workspaceResponse = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === "/api/v1/workspaces",
  );
  await page.getByRole("button", { name: "Create Workspace" }).click();
  const workspaceID = (
    (await (await workspaceResponse).json()) as { data: { id: string } }
  ).data.id;

  const documentID = randomUUID();
  const rootNodeID = randomUUID();
  const paragraphNodeID = randomUUID();
  const accessCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "thisisjustarandomstring",
  );
  expect(accessCookie).toBeDefined();
  const apiURL = process.env.API_URL ?? "http://localhost:8080";
  const headers = {
    Authorization: `Bearer ${accessCookie!.value}`,
    "X-Workspace-Id": workspaceID,
  };
  const node = (
    nodeID: string,
    parentID: string | null,
    type: string,
    content = "",
  ) => ({
    nodeID,
    parentID,
    siblingOrder: 1,
    type,
    content,
    attributes: {},
  });
  const created = await page.request.post(`${apiURL}/api/v1/documents`, {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      title: `G7 doc ${suffix}`,
      type: "markdown",
      isDraft: true,
      initialBody: {
        documentID,
        bodySchemaVersion: 1,
        rootNodeID,
        nodes: [
          node(rootNodeID, null, "document"),
          node(paragraphNodeID, rootNodeID, "paragraph"),
          node(randomUUID(), paragraphNodeID, "run", "Start"),
        ],
      },
    },
  });
  expect(created.status()).toBe(201);

  await page.goto(`/docs/${documentID}`);
  const documentURL = page.url();
  const editor = page.locator('.ProseMirror[contenteditable="true"]');
  await expect(editor).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Synced");
  await page.getByRole("button", { name: "Edit", exact: true }).click();

  const secondContext = await browser.newContext({
    storageState: await page.context().storageState(),
  });
  const secondPage = await secondContext.newPage();
  await secondPage.goto(documentURL);
  const secondEditor = secondPage.locator(
    '.ProseMirror[contenteditable="true"]',
  );
  await expect(secondEditor).toBeVisible();
  await expect(secondPage.getByRole("status")).toContainText("Synced");

  // Client one inserts a table from the toolbar and fills the first cells with Tab.
  await page.getByText("Start", { exact: true }).click();
  await page.getByRole("button", { name: "Insert table" }).click();
  await page.keyboard.type("alpha");
  await page.keyboard.press("Tab");
  await page.keyboard.type("beta");

  await expect(editor.locator("table td").nth(0)).toHaveText("alpha");
  await expect(secondEditor.locator("table td").nth(0)).toHaveText("alpha");
  await expect(secondEditor.locator("table td").nth(1)).toHaveText("beta");

  // Client two appends a row and writes into it.
  await secondEditor.locator("table td").nth(1).click();
  await secondPage.getByRole("button", { name: "Add table row below" }).click();
  await secondPage.keyboard.type("gamma");
  await expect(editor.locator("table tr")).toHaveCount(4);
  await expect(editor.locator("table td").nth(3)).toHaveText("gamma");

  // The server projection holds the same table.
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `${apiURL}/api/v1/documents/${documentID}/body`,
        { headers },
      );
      const nodes = ((await response.json()).data.nodes ?? []) as {
        type: string;
        content: string;
      }[];
      return {
        rows: nodes.filter((n) => n.type === "table.row").length,
        cells: nodes
          .filter((n) => n.type === "table.cell")
          .map((n) => n.content)
          .filter(Boolean),
      };
    })
    .toEqual({ rows: 4, cells: ["alpha", "beta", "gamma"] });

  await secondContext.close();
});

test.fixme("@live: bold, italic, nested lists and undo/redo converge (needs #28-#30)", async () => {});
