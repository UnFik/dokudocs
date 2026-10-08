import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createdDocumentID, documentPayload } from "../../helpers/markdown-document";

test("@live @smoke: undo and redo only touch the local user's edits", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const suffix = `${Date.now()}`;
  const workspaceName = `Undo workspace ${suffix}`;

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
  const workspaceID = (
    (await (await workspaceResponse).json()) as { data: { id: string } }
  ).data.id;

  let documentID = "";
  const rootNodeID = randomUUID();
  const paragraphs = ["First block", "Second block"].map((content) => ({
    paragraphID: randomUUID(),
    runID: randomUUID(),
    content,
  }));
  const accessCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "thisisjustarandomstring",
  );
  expect(accessCookie).toBeDefined();
  const apiURL = process.env.API_URL ?? "http://localhost:8080";
  const created = await page.request.post(`${apiURL}/api/v1/documents`, {
    headers: {
      Authorization: `Bearer ${accessCookie!.value}`,
      "X-Workspace-Id": workspaceID,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      title: `Undo doc ${suffix}`,
      type: "markdown",
      isDraft: true,
      ...documentPayload([
          {
            nodeID: rootNodeID,
            parentID: null,
            siblingOrder: 1,
            type: "document",
            content: "",
            attributes: {},
          },
          ...paragraphs.flatMap((item, index) => [
            {
              nodeID: item.paragraphID,
              parentID: rootNodeID,
              siblingOrder: index + 1,
              type: "paragraph",
              content: "",
              attributes: {},
            },
            {
              nodeID: item.runID,
              parentID: item.paragraphID,
              siblingOrder: 1,
              type: "run",
              content: item.content,
              attributes: {},
            },
          ]),
        ]),
    },
  });
  expect(created.status()).toBe(201);
  documentID = await createdDocumentID(created);

  await page.goto(`/docs/${documentID}`);
  const documentURL = page.url();
  const editorA = page.locator('.ProseMirror[contenteditable="true"]');
  await expect(editorA).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Synced");
  await page.getByRole("button", { name: /^Editor mode/ }).click();
  await page.getByRole("menuitemradio", { name: "Edit", exact: true }).click();

  const secondContext = await browser.newContext({
    storageState: await page.context().storageState(),
  });
  const pageB = await secondContext.newPage();
  await pageB.goto(documentURL);
  const editorB = pageB.locator('.ProseMirror[contenteditable="true"]');
  await expect(editorB).toBeVisible();
  await expect(pageB.getByRole("status")).toContainText("Synced");

  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  await editorA.locator("p").filter({ hasText: "First block" }).click();
  await editorA.press("End");
  await page.keyboard.type(" by A");
  await expect(editorB).toContainText("First block by A");

  await editorB.locator("p").filter({ hasText: "Second block" }).click();
  await editorB.press("End");
  await pageB.keyboard.type(" by B");
  await expect(editorA).toContainText("Second block by B");

  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editorA).not.toContainText("by A");
  await expect(editorA).toContainText("Second block by B");
  await expect(editorB).not.toContainText("by A");
  await expect(editorB).toContainText("Second block by B");

  await page.getByRole("button", { name: "Redo" }).click();
  await expect(editorA).toContainText("First block by A");
  await expect(editorB).toContainText("First block by A");

  await page.keyboard.press("ControlOrMeta+z");
  await pageB.keyboard.press("ControlOrMeta+z");
  await expect(editorA).not.toContainText("by B");
  await expect(editorB).not.toContainText("by B");
  await expect(editorA).not.toContainText("by A");

  await secondContext.close();
});
