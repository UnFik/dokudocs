import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

// Issue #29: the floating selection toolbar, driven by real clicks, writes
// bold and link marks that the server body keeps.
test("@live @smoke: floating selection toolbar applies bold and a link", async ({
  page,
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
  await page.getByLabel("Workspace Name").fill(`Toolbar ${suffix}`);
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
      title: `Toolbar doc ${suffix}`,
      type: "markdown",
      isDraft: true,
      initialBody: {
        documentID,
        bodySchemaVersion: 1,
        rootNodeID,
        nodes: [
          node(rootNodeID, null, "document"),
          node(paragraphNodeID, rootNodeID, "paragraph"),
          node(randomUUID(), paragraphNodeID, "run", "alpha beta gamma"),
        ],
      },
    },
  });
  expect(created.status()).toBe(201);

  await page.goto(`/docs/${documentID}`);
  const editor = page.locator('.ProseMirror[contenteditable="true"]');
  await expect(editor).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Synced");
  await page.getByRole("button", { name: "Edit", exact: true }).click();


  const toolbar = page.getByRole("toolbar", { name: "Format selection" });
  const selectWord = async (word: string) => {
    await editor.evaluate((root, target) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const at = n.textContent?.indexOf(target) ?? -1;
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(n, at);
        range.setEnd(n, at + target.length);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
      throw new Error(`text ${target} not found`);
    }, word);
  };

  const readRuns = async () => {
    const response = await page.request.get(
      `${apiURL}/api/v1/documents/${documentID}/body`,
      { headers },
    );
    const nodes = ((await response.json()).data.nodes ?? []) as {
      parentID: string | null;
      siblingOrder: number;
      type: string;
      content: string;
      attributes: Record<string, unknown>;
    }[];
    return nodes
      .filter((n) => n.type === "run")
      .sort((a, b) => a.siblingOrder - b.siblingOrder)
      .map((n) => ({ text: n.content, attributes: n.attributes }));
  };

  // Bold: select "alpha", click the toolbar button.
  await selectWord("alpha");
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: "Bold" }).click();
  await expect(editor.locator("strong")).toHaveText("alpha");

  // Link: select "beta", open the link form from the toolbar, apply an address.
  await selectWord("beta");
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: "Link", exact: true }).click();
  await toolbar.getByLabel("Link address").fill("https://example.com/docs");
  await toolbar.getByRole("button", { name: "Apply link" }).click();
  await expect(editor.locator("[data-link-href]")).toHaveText("beta");

  await expect
    .poll(readRuns)
    .toEqual([
      { text: "alpha", attributes: { bold: true } },
      { text: " ", attributes: {} },
      { text: "beta", attributes: { href: "https://example.com/docs" } },
      { text: " gamma", attributes: {} },
    ]);
});
