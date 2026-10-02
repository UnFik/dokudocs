import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

// Gate G7 (#36): two clients edit tables through the toolbar, converge, and the
// server projection matches. A second case covers inline marks, nested lists and
// undo across the two clients.
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

test("@live @smoke: bold, italic, nested list and undo converge across two clients", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const suffix = `${Date.now()}`;

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
  await page.getByLabel("Workspace Name").fill(`G7 marks ${suffix}`);
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
      title: `G7 marks doc ${suffix}`,
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

  // Client one types bold and italic runs with the keyboard shortcuts.
  await page.getByText("Start", { exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" ");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type("bold");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type(" ");
  await page.keyboard.press("ControlOrMeta+i");
  await page.keyboard.type("slanted");
  await page.keyboard.press("ControlOrMeta+i");
  await expect(secondEditor.locator("strong")).toHaveText("bold");
  await expect(secondEditor.locator("em")).toHaveText("slanted");

  // Client one starts a list from the slash menu and nests a second list inside it.
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await page.getByRole("option", { name: /Bulleted list/ }).click();
  await page.keyboard.type("outer");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await page.getByRole("option", { name: /Bulleted list/ }).click();
  await page.keyboard.type("inner");
  await expect(secondEditor.locator("ul ul li")).toHaveText("inner");
  await expect(secondEditor.locator("ul > li").first()).toContainText("outer");

  // Client one adds text to the nested item as a separate undo step (the Yjs
  // undo manager merges edits made within 500 ms).
  await page.waitForTimeout(700);
  await page.keyboard.type(" tail");
  await expect(secondEditor.locator("ul ul li")).toHaveText("inner tail");

  // Client two edits the first paragraph; client one's undo must keep that edit.
  await secondEditor.getByText("slanted", { exact: true }).click();
  await secondPage.keyboard.press("End");
  await secondPage.keyboard.type(" by B");
  await expect(editor.locator("p").first()).toContainText("by B");

  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor.locator("ul ul li")).toHaveText("inner");
  await expect(secondEditor.locator("ul ul li")).toHaveText("inner");
  await expect(editor.locator("p").first()).toContainText("by B");
  await expect(secondEditor.locator("p").first()).toContainText("by B");

  await page.getByRole("button", { name: "Redo" }).click();
  await expect(editor.locator("ul ul li")).toHaveText("inner tail");
  await expect(secondEditor.locator("ul ul li")).toHaveText("inner tail");
  await expect(secondEditor.locator("p").first()).toContainText("by B");

  const readBody = async () => {
    const response = await page.request.get(
      `${apiURL}/api/v1/documents/${documentID}/body`,
      { headers },
    );
    return ((await response.json()).data.nodes ?? []) as {
      nodeID: string;
      parentID: string | null;
      type: string;
      content: string;
      attributes: Record<string, unknown>;
    }[];
  };
  // The server body holds the marks as run attributes and the nested list as
  // a list inside the outer list item.
  await expect
    .poll(async () => {
      const nodes = await readBody();
      const first = nodes.find(
        (n) => n.type === "paragraph" && n.parentID === rootNodeID,
      );
      const runs = nodes
        .filter((n) => n.parentID === first?.nodeID)
        .map((n) => ({ text: n.content, attributes: n.attributes }));
      const lists = nodes.filter((n) => n.type === "bullet-list");
      const nested = lists.find((l) =>
        nodes.some((n) => n.nodeID === l.parentID && n.type === "list-item"),
      );
      return {
        runs,
        listItemText: nodes
          .filter(
            (n) =>
              n.type === "paragraph" &&
              nodes.find((p) => p.nodeID === n.parentID)?.type === "list-item",
          )
          .map((n) => n.content)
          .filter(Boolean),
        nestedInsideItem: nested !== undefined,
      };
    })
    .toEqual({
      runs: [
        { text: "Start ", attributes: {} },
        { text: "bold", attributes: { bold: true } },
        { text: " ", attributes: {} },
        { text: "slanted by B", attributes: { italic: true } },
      ],
      listItemText: ["outer", "inner tail"],
      nestedInsideItem: true,
    });

  // Export copies the Markdown rendered from that body.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: "Copy Raw Code" }).click();
  const exported = await page.evaluate(() => navigator.clipboard.readText());
  const lines = exported.split("\n").filter((line) => line.trim() !== "");
  expect(lines).toEqual([
    "Start **bold** *slanted by B*",
    "- outer",
    "- ", // the blank paragraph that holds the nested list's item
    "  - inner tail",
  ]);

  await secondContext.close();
});
