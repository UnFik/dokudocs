import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";

const apiURL = process.env.API_URL ?? "http://localhost:8080";
const commenterPassword = "password12345678";

async function seedTwoParagraphDocument(page: Page) {
  const suffix = randomUUID();
  const documentID = randomUUID();
  const rootNodeID = randomUUID();
  const firstParagraphID = randomUUID();
  const firstRunID = randomUUID();
  const secondParagraphID = randomUUID();
  const secondRunID = randomUUID();
  const commenterEmail = `structure-${suffix}@example.invalid`;

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
  await page.getByLabel("Workspace Name").fill(`Structure workspace ${suffix}`);
  const workspaceResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/workspaces",
  );
  await page.getByRole("button", { name: "Create Workspace" }).click();
  const workspaceID = (
    (await (await workspaceResponse).json()) as { data: { id: string } }
  ).data.id;
  const accessCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "thisisjustarandomstring",
  );
  expect(accessCookie).toBeDefined();
  const ownerHeaders = {
    Authorization: `Bearer ${accessCookie!.value}`,
    "X-Workspace-Id": workspaceID,
  };
  const node = (
    nodeID: string,
    parentID: string | null,
    siblingOrder: number,
    type: string,
    content = "",
  ) => ({ nodeID, parentID, siblingOrder, type, content, attributes: {} });
  const createResponse = await page.request.post(`${apiURL}/api/v1/documents`, {
    headers: { ...ownerHeaders, "Idempotency-Key": randomUUID() },
    data: {
      title: `Structure document ${suffix}`,
      type: "markdown",
      visibility: "private",
      initialBody: {
        documentID,
        bodySchemaVersion: 1,
        rootNodeID,
        nodes: [
          node(rootNodeID, null, 1, "document"),
          node(firstParagraphID, rootNodeID, 1, "paragraph"),
          node(firstRunID, firstParagraphID, 1, "run", "Keep this block"),
          node(secondParagraphID, rootNodeID, 2, "paragraph"),
          node(secondRunID, secondParagraphID, 1, "run", "Remove this block"),
        ],
      },
    },
  });
  expect(createResponse.status()).toBe(201);
  expect(
    (
      await page.request.post(`${apiURL}/api/v1/auth/register`, {
        data: {
          email: commenterEmail,
          password: commenterPassword,
          fullName: "Structure Commenter",
        },
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await page.request.post(
        `${apiURL}/api/v1/workspaces/${workspaceID}/invites`,
        {
          headers: ownerHeaders,
          data: { email: commenterEmail, role: "member" },
        },
      )
    ).status(),
  ).toBe(201);
  expect(
    (
      await page.request.post(
        `${apiURL}/api/v1/documents/${documentID}/accesses`,
        {
          headers: ownerHeaders,
          data: { email: commenterEmail, level: "comment" },
        },
      )
    ).status(),
  ).toBe(201);
  return { documentID, secondRunID, secondParagraphID, commenterEmail };
}

async function signInCommenter(browser: Browser, email: string) {
  const context = await browser.newContext();
  const commenter = await context.newPage();
  await commenter.goto("/sign-in");
  await commenter.locator('input[name="email"]').fill(email);
  await commenter.locator('input[name="password"]').fill(commenterPassword);
  await commenter.getByRole("button", { name: /sign in/i }).click();
  await commenter.waitForURL((url) => url.pathname === "/");
  return { context, commenter };
}

test("@live: commenter suggests deleting a block, sees it marked, owner accepts", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const { documentID, secondRunID, secondParagraphID, commenterEmail } =
    await seedTwoParagraphDocument(page);
  const { context, commenter } = await signInCommenter(browser, commenterEmail);
  try {
    await commenter.goto(`/docs/${documentID}`);
    const editor = commenter.locator(".ProseMirror");
    await expect(editor).toContainText("Remove this block");
    await commenter.locator(`#node-${secondRunID}`).evaluate((run) => {
      const range = document.createRange();
      range.setStart(run.firstChild!, 3);
      range.collapse(true);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await commenter
      .getByRole("button", { name: "Suggest delete block" })
      .click();
    await expect(
      commenter.getByText("Delete paragraph “Remove this block”"),
    ).toBeVisible();
    await expect(commenter.getByText("pending · human")).toBeVisible();

    const marked = commenter.locator(`[data-node-id="${secondParagraphID}"]`);
    await expect(marked).toBeVisible();
    await expect(marked).toHaveCSS("text-decoration-line", "line-through");
    await expect(editor).toContainText("Remove this block");
    await expect(commenter.getByRole("button", { name: "Accept" })).toHaveCount(
      0,
    );

    await page.goto(`/docs/${documentID}`);
    await page
      .getByRole("button", { name: "Suggestions", exact: true })
      .click();
    await page.getByRole("button", { name: "Accept" }).click();
    await expect(page.locator(".ProseMirror")).not.toContainText(
      "Remove this block",
    );
    await expect(editor).not.toContainText("Remove this block");
    await expect(editor).toContainText("Keep this block");
  } finally {
    await context.close();
  }
});

test("@live: a stale batch is shown as not applied with its reason, on a phone-width panel", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const { documentID, secondRunID, commenterEmail } =
    await seedTwoParagraphDocument(page);
  const { context, commenter } = await signInCommenter(browser, commenterEmail);
  try {
    await commenter.setViewportSize({ width: 390, height: 800 });
    await commenter.goto(`/docs/${documentID}`);
    await expect(commenter.locator(".ProseMirror")).toContainText(
      "Remove this block",
    );
    for (const expected of [1, 2]) {
      await commenter.locator(`#node-${secondRunID}`).evaluate((run) => {
        const range = document.createRange();
        range.setStart(run.firstChild!, 3);
        range.collapse(true);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      });
      await commenter
        .getByRole("button", { name: "Suggest delete block" })
        .click();
      await expect(commenter.getByText("pending · human")).toHaveCount(
        expected,
      );
    }
    const overflow = await commenter.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await page.goto(`/docs/${documentID}`);
    await page
      .getByRole("button", { name: "Suggestions", exact: true })
      .click();
    await expect(page.getByRole("button", { name: "Accept" })).toHaveCount(2);
    await page.getByRole("button", { name: "Accept" }).first().click();
    await expect(page.locator(".ProseMirror")).not.toContainText(
      "Remove this block",
    );
    // The structural accept remounts the editor, which closes the panel.
    const toggle = page.getByRole("button", {
      name: "Suggestions",
      exact: true,
    });
    await expect(async () => {
      if (await toggle.isVisible()) await toggle.click();
      await expect(page.getByText("accepted · human")).toBeVisible({
        timeout: 1000,
      });
    }).toPass();
    await page.getByRole("button", { name: "Accept" }).click();
    await expect(async () => {
      if (await toggle.isVisible()) await toggle.click();
      await expect(
        page.getByText(
          "Not applied: the document changed after this was proposed.",
          { exact: false },
        ),
      ).toBeVisible({ timeout: 1000 });
    }).toPass();
    await expect(
      page.getByText(
        "Not applied: the document changed after this was proposed.",
        { exact: false },
      ),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
