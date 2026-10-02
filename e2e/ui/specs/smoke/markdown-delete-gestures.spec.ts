import { test, expect, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

// Structural deletes round-trip to the server and remount the editor, so they
// take longer than the default assertion wait.
expect.configure({ timeout: 15000 });

// Real keyboard, real editor, real server. Unit tests of the editor cannot see
// what the server does with the commands these gestures send.

type Block = { kind: "paragraph"; text: string } | { kind: "separator" };

// When a gesture does nothing, the page state says why; attach it to the failure.
function watch(page: Page) {
  const log: string[] = [];
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type()))
      log.push(`console.${m.type()}: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) =>
    log.push(`pageerror: ${e.message.slice(0, 200)}`),
  );
  page.on("response", (r) => {
    const path = new URL(r.url()).pathname;
    if (path.includes("/body/"))
      log.push(
        `HTTP ${r.request().method()} ${path.split("/").slice(-2).join("/")} -> ${r.status()}`,
      );
  });
  return async <T>(run: () => Promise<T>) => {
    try {
      return await run();
    } catch (error) {
      const alerts = await page.getByRole("alert").allTextContents();
      const status = await page.getByRole("status").allTextContents();
      throw new Error(
        `${(error as Error).message}\n--- page: alerts=${JSON.stringify(alerts)} status=${JSON.stringify(status)}\n${log.join("\n")}`,
      );
    }
  };
}

async function openDocument(page: Page, blocks: Block[]) {
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
  await page.getByLabel("Workspace Name").fill(`Delete workspace ${suffix}`);
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
  blocks.forEach((block, index) => {
    const blockID = randomUUID();
    if (block.kind === "separator") {
      nodes.push({
        nodeID: blockID,
        parentID: rootNodeID,
        siblingOrder: index + 1,
        type: "thematic-break",
        content: "",
        attributes: {},
      });
      return;
    }
    nodes.push(
      {
        nodeID: blockID,
        parentID: rootNodeID,
        siblingOrder: index + 1,
        type: "paragraph",
        content: "",
        attributes: {},
      },
      {
        nodeID: randomUUID(),
        parentID: blockID,
        siblingOrder: 1,
        type: "run",
        content: block.text,
        attributes: {},
      },
    );
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
      title: `Delete doc ${suffix}`,
      type: "markdown",
      isDraft: true,
      initialBody: { documentID, bodySchemaVersion: 1, rootNodeID, nodes },
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

async function expectNoReviewBanner(page: Page) {
  await expect(page.getByText(/Local changes need review/)).toHaveCount(0);
  await expect(page.getByText(/structural deletion requires/)).toHaveCount(0);
}

const separatorDoc: Block[] = [
  { kind: "paragraph", text: "First block" },
  { kind: "separator" },
  { kind: "paragraph", text: "Second block" },
];

async function expectSeparatorGone(page: Page, editor: Locator) {
  await expect(editor.locator("hr")).toHaveCount(0);
  await expect(editor).toContainText("First block");
  await expect(editor).toContainText("Second block");
  await expectNoReviewBanner(page);
  await page.reload();
  await expect(page.getByRole("status")).toContainText("Synced");
  await expect(editor.locator("hr")).toHaveCount(0);
  await expect(editor).toContainText("Second block");
}

test("@live @smoke @deletegestures: Delete at the end of the paragraph before a separator removes it", async ({
  page,
}) => {
  test.setTimeout(90000);
  const diagnose = watch(page);
  const { editor } = await openDocument(page, separatorDoc);
  await diagnose(async () => {
    await editor.locator("p").filter({ hasText: "First block" }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Delete");
    await expectSeparatorGone(page, editor);
  });
});

test("@live @smoke @deletegestures: Backspace at the start of the paragraph after a separator removes it", async ({
  page,
}) => {
  test.setTimeout(90000);
  const { editor } = await openDocument(page, separatorDoc);
  await editor.locator("p").filter({ hasText: "Second block" }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Backspace");
  await expectSeparatorGone(page, editor);
});

test("@live @smoke @deletegestures: clicking a separator then Delete removes it", async ({
  page,
}) => {
  test.setTimeout(90000);
  const { editor } = await openDocument(page, separatorDoc);
  await editor.locator("hr").click();
  await page.keyboard.press("Delete");
  await expectSeparatorGone(page, editor);
});

test("@live @smoke @deletegestures: after Ctrl+A Delete the document accepts new text and keeps it", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { editor, documentURL } = await openDocument(page, [
    { kind: "paragraph", text: "First block" },
    { kind: "separator" },
    { kind: "paragraph", text: "Second block" },
  ]);
  await editor.locator("p").filter({ hasText: "Second block" }).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await expect(editor).not.toContainText("First block");
  await expect(editor).not.toContainText("Second block");
  await expect(editor.locator("hr")).toHaveCount(0);
  await expectNoReviewBanner(page);

  await page.reload();
  await expect(page.getByRole("status")).toContainText("Synced");
  await expect(editor).not.toContainText("block");
  await editor.locator("p").first().click();
  await page.keyboard.type("Typed again");
  await expect(editor).toContainText("Typed again");
  await expectNoReviewBanner(page);
  await page.goto(documentURL);
  await expect(page.getByRole("status")).toContainText("Synced");
  await expect(editor).toContainText("Typed again");
  await expectNoReviewBanner(page);
});

test("@live @smoke @deletegestures: Ctrl+A then Backspace removes everything", async ({
  page,
}) => {
  test.setTimeout(90000);
  const { editor } = await openDocument(page, [
    { kind: "paragraph", text: "Alpha" },
    { kind: "paragraph", text: "Beta" },
    { kind: "paragraph", text: "Gamma" },
  ]);
  await editor.locator("p").filter({ hasText: "Beta" }).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await expect(editor).not.toContainText("Alpha");
  await expect(editor).not.toContainText("Gamma");
  await expectNoReviewBanner(page);
  await page.reload();
  await expect(page.getByRole("status")).toContainText("Synced");
  await expect(editor).not.toContainText("Beta");
});

test("@live @smoke @deletegestures: deleting text across blocks keeps the rest and syncs", async ({
  page,
}) => {
  test.setTimeout(90000);
  const diagnose = watch(page);
  const { editor } = await openDocument(page, [
    { kind: "paragraph", text: "Keep this start and drop" },
    { kind: "paragraph", text: "middle block" },
    { kind: "paragraph", text: "drop and keep this end" },
  ]);
  await diagnose(async () => {
    // Click inside the first paragraph, extend the selection into the third.
    await editor.locator("p").filter({ hasText: "Keep this start" }).click();
    await page.keyboard.press("Home");
    for (let i = 0; i < 15; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.down("Shift");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.up("Shift");
    await page.keyboard.press("Backspace");
    await expect(editor).not.toContainText("middle block");
    await expect(editor).toContainText("Keep this start");
    await expectNoReviewBanner(page);
    await page.reload();
    await expect(page.getByRole("status")).toContainText("Synced");
    await expect(editor).not.toContainText("middle block");
    await expect(editor).toContainText("Keep this start");
  });
});
