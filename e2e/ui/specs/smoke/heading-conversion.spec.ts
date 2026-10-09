import { inDocumentOrder } from "../../helpers/document-order";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createdDocumentID, documentPayload, storedNodes } from "../../helpers/markdown-document";

type BodyNode = {
  nodeID: string;
  parentID: string | null;
  siblingOrder: number;
  type: string;
  content: string;
  attributes: Record<string, unknown>;
};

async function placeCaret(editor: Locator, block: Locator) {
  await block.click();
  await expect
    .poll(() => block.evaluate((el) => el.contains(getSelection()?.anchorNode ?? null)))
    .toBe(true);
}

// Issues #55 and #56: headings render as h1-h6, and converting an existing
// block (empty or not) to a heading and back is accepted by the server.
test("@live @smoke: slash Heading 2 and Ctrl+Alt shortcuts convert blocks, render h1-h6 and persist", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const suffix = `${Date.now()}`;
  const apiURL = process.env.API_URL ?? "http://localhost:8080";

  await page.goto("/sign-in");
  await page.locator('input[name="email"]').fill("admin@example.com");
  await page.locator('input[name="password"]').fill("password123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname === "/dashboard");
  const token = (await page.context().cookies()).find(
    (cookie) => cookie.name === "thisisjustarandomstring",
  )!.value;
  // Create the workspace through the UI: that makes it the active workspace, which
  // the document page uses to load the document. A workspace made through the API
  // is not active, so the document would be looked up in another workspace.
  await page
    .getByRole("button", { name: /workspace/i })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Create Workspace" }).click();
  await page.getByLabel("Workspace Name").fill(`Heading ${suffix}`);
  const workspaceResponse = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === "/api/v1/workspaces",
  );
  await page.getByRole("button", { name: "Create Workspace" }).click();
  const workspaceID = (
    (await (await workspaceResponse).json()) as { data: { id: string } }
  ).data.id;
  const headers = { Authorization: `Bearer ${token}`, "X-Workspace-Id": workspaceID };

  let documentID = "";
  const rootID = randomUUID();
  const emptyID = randomUUID();
  const plainID = randomUUID();
  const node = (
    nodeID: string,
    parentID: string | null,
    siblingOrder: number,
    type: string,
    content = "",
  ) => ({ nodeID, parentID, siblingOrder, type, content, attributes: {} });
  const created = await page.request.post(`${apiURL}/api/v1/documents`, {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      title: `Heading doc ${suffix}`,
      type: "markdown",
      isDraft: true,
      ...documentPayload([
          node(rootID, null, 0, "document"),
          node(emptyID, rootID, 1, "paragraph"),
          node(plainID, rootID, 2, "paragraph"),
          node(randomUUID(), plainID, 0, "run", "Plain text"),
        ]),
    },
  });
  expect(created.status()).toBe(201);
  documentID = await createdDocumentID(created);

  await page.goto(`/docs/${documentID}`);
  const documentURL = page.url();
  const editor = page.locator('.ProseMirror[contenteditable="true"]');
  await expect(editor).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Synced");
  await page.getByRole("button", { name: /^Editor mode/ }).click();
  await page.getByRole("menuitemradio", { name: "Edit", exact: true }).click();

  const secondContext = await browser.newContext({
    storageState: await page.context().storageState(),
  });
  const secondPage = await secondContext.newPage();
  await secondPage.goto(documentURL);
  const secondEditor = secondPage.locator('.ProseMirror[contenteditable="true"]');
  await expect(secondEditor).toBeVisible();
  await expect(secondPage.getByRole("status")).toContainText("Synced");

  const serverNodes = async () => {
    const response = { json: async () => ({ data: { nodes: await storedNodes(page, documentID, headers) } }) };
    return inDocumentOrder(((await response.json()).data.nodes ?? []) as BodyNode[]);
  };
  const expectNoRejection = async (p: Page) => {
    await expect(p.getByText(/update.rejected/i)).toHaveCount(0);
    await expect(p.getByRole("status")).toContainText("Synced");
  };

  // Slash menu on the empty paragraph that already exists on the server.
  await editor.locator("p").first().click();
  await page.keyboard.press("/");
  await expect(page.getByRole("combobox", { name: "Insert block" })).toBeFocused();
  await page.keyboard.type("Heading 2");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Section title");
  await expect(editor.locator("h2")).toHaveText("Section title");
  await expect(secondEditor.locator("h2")).toHaveText("Section title");
  await expect
    .poll(async () => {
      const heading = (await serverNodes()).find((n) => n.nodeID === emptyID);
      return heading && { type: heading.type, level: heading.attributes.level };
    })
    .toEqual({ type: "atx-heading", level: 2 });
  await expectNoRejection(page);
  await expectNoRejection(secondPage);

  // A non-empty paragraph: Ctrl+Alt+3, then 5, then back to a paragraph.
  await placeCaret(editor, editor.locator("p").filter({ hasText: "Plain text" }));
  await page.keyboard.press("Control+Alt+3");
  await expect(editor.locator("h3")).toHaveText("Plain text");
  await expect(secondEditor.locator("h3")).toHaveText("Plain text");
  await page.keyboard.press("Control+Alt+5");
  await expect(editor.locator("h5")).toHaveText("Plain text");
  await expect(secondEditor.locator("h5")).toHaveText("Plain text");
  await expect
    .poll(async () => {
      const heading = (await serverNodes()).find((n) => n.nodeID === plainID);
      return heading && { type: heading.type, level: heading.attributes.level };
    })
    .toEqual({ type: "atx-heading", level: 5 });

  await page.keyboard.press("Control+Alt+0");
  await expect(editor.locator("p").filter({ hasText: "Plain text" })).toHaveCount(1);
  await expect(secondEditor.locator("p").filter({ hasText: "Plain text" })).toHaveCount(1);
  await expect
    .poll(async () => (await serverNodes()).find((n) => n.nodeID === plainID)?.type)
    .toBe("paragraph");
  await expectNoRejection(page);
  await expectNoRejection(secondPage);

  // Every level renders as its own tag on both clients.
  for (const level of [1, 4, 6]) {
    await page.keyboard.press(`Control+Alt+${level}`);
    await expect(editor.locator(`h${level}`)).toHaveText("Plain text");
    await expect(secondEditor.locator(`h${level}`)).toHaveText("Plain text");
  }
  await expectNoRejection(page);

  await secondContext.close();
});
