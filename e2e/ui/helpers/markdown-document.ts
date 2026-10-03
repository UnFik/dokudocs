import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

/**
 * Signs in as the seeded admin, makes a workspace and a Markdown document with
 * one paragraph per entry of `paragraphs`, and opens it in Edit mode.
 */
export async function openMarkdownDocument(
  page: Page,
  paragraphs: string[] = ["start"],
) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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
  await page.getByLabel("Workspace Name").fill(`Input workspace ${suffix}`);
  const workspaceResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/workspaces",
  );
  await page.getByRole("button", { name: "Create Workspace" }).click();
  const workspaceID = (
    (await (await workspaceResponse).json()) as { data: { id: string } }
  ).data.id;

  const documentID = randomUUID();
  const rootNodeID = randomUUID();
  const nodes: unknown[] = [
    {
      nodeID: rootNodeID,
      parentID: null,
      siblingOrder: 1,
      type: "document",
      content: "",
      attributes: {},
    },
  ];
  paragraphs.forEach((text, index) => {
    const paragraphID = randomUUID();
    nodes.push({
      nodeID: paragraphID,
      parentID: rootNodeID,
      siblingOrder: index + 1,
      type: "paragraph",
      content: "",
      attributes: {},
    });
    if (text)
      nodes.push({
        nodeID: randomUUID(),
        parentID: paragraphID,
        siblingOrder: 1,
        type: "run",
        content: text,
        attributes: {},
      });
  });
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
      title: `Input doc ${suffix}`,
      type: "markdown",
      isDraft: true,
      initialBody: {
        documentID,
        bodySchemaVersion: 1,
        rootNodeID,
        nodes,
      },
    },
  });
  expect(created.status()).toBe(201);

  await page.goto(`/docs/${documentID}`);
  const editor = page.locator('.ProseMirror[contenteditable="true"]');
  await expect(editor).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("status")).toContainText("Synced");
  await page.getByRole("tab", { name: "Edit", exact: true }).click();
  return { editor, documentURL: page.url() };
}

/** Pastes plain text into the editor as the browser would, at the caret. */
export async function pastePlainText(page: Page, text: string) {
  await page.evaluate((value) => {
    const element = document.querySelector(".ProseMirror")!;
    const data = new DataTransfer();
    data.setData("text/plain", value);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, text);
}

/** What the user must never see from an ordinary gesture. */
export async function expectNoInternalMessage(page: Page) {
  await expect(page.getByText(/Local changes need review/)).toHaveCount(0);
  await expect(page.getByText(/structural deletion requires/)).toHaveCount(0);
  await expect(page.getByText(/cannot be deleted in one step/)).toHaveCount(0);
  await expect(page.getByText(/cannot be imported/)).toHaveCount(0);
  await expect(page.getByText(/Block deletion is queued/)).toHaveCount(0);
}
