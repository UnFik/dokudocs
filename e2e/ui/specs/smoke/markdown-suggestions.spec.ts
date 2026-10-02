import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("@live: commenter proposes a text change without editing the canonical body", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const suffix = randomUUID();
  const workspaceName = `Suggestion workspace ${suffix}`;
  const documentID = randomUUID();
  const rootNodeID = randomUUID();
  const paragraphNodeID = randomUUID();
  const runNodeID = randomUUID();
  const commenterEmail = `suggestion-${suffix}@example.invalid`;
  const commenterPassword = "password12345678";
  const apiURL = process.env.API_URL ?? "http://localhost:8080";

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
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/workspaces",
  );
  await page.getByRole("button", { name: "Create Workspace" }).click();
  const workspaceID = (
    (await (await workspaceResponse).json()) as {
      data: { id: string };
    }
  ).data.id;

  const accessCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "thisisjustarandomstring",
  );
  expect(accessCookie).toBeDefined();
  const ownerHeaders = {
    Authorization: `Bearer ${accessCookie!.value}`,
    "X-Workspace-Id": workspaceID,
  };
  const createResponse = await page.request.post(`${apiURL}/api/v1/documents`, {
    headers: { ...ownerHeaders, "Idempotency-Key": randomUUID() },
    data: {
      title: `Suggestion document ${suffix}`,
      type: "markdown",
      visibility: "private",
      initialBody: {
        documentID,
        bodySchemaVersion: 1,
        rootNodeID,
        nodes: [
          {
            nodeID: rootNodeID,
            parentID: null,
            siblingOrder: 1,
            type: "document",
            content: "",
            attributes: {},
          },
          {
            nodeID: paragraphNodeID,
            parentID: rootNodeID,
            siblingOrder: 1,
            type: "paragraph",
            content: "",
            attributes: {},
          },
          {
            nodeID: runNodeID,
            parentID: paragraphNodeID,
            siblingOrder: 1,
            type: "run",
            content: "Original phrase",
            attributes: {},
          },
        ],
      },
    },
  });
  expect(createResponse.status()).toBe(201);

  const registerResponse = await page.request.post(
    `${apiURL}/api/v1/auth/register`,
    {
      data: {
        email: commenterEmail,
        password: commenterPassword,
        fullName: "Suggestion Commenter",
      },
    },
  );
  expect(registerResponse.status()).toBe(201);
  const inviteResponse = await page.request.post(
    `${apiURL}/api/v1/workspaces/${workspaceID}/invites`,
    { headers: ownerHeaders, data: { email: commenterEmail, role: "member" } },
  );
  expect(inviteResponse.status()).toBe(201);
  const grantResponse = await page.request.post(
    `${apiURL}/api/v1/documents/${documentID}/accesses`,
    {
      headers: ownerHeaders,
      data: { email: commenterEmail, level: "comment" },
    },
  );
  expect(grantResponse.status()).toBe(201);

  const commenterContext = await browser.newContext();
  try {
    const commenter = await commenterContext.newPage();
    await commenter.goto("/sign-in");
    await commenter.locator('input[name="email"]').fill(commenterEmail);
    await commenter.locator('input[name="password"]').fill(commenterPassword);
    await commenter.getByRole("button", { name: /sign in/i }).click();
    await commenter.waitForURL((url) => url.pathname === "/");
    await commenter.goto(`/docs/${documentID}`);
    const commenterEditor = commenter.locator(".ProseMirror");
    await expect(commenterEditor).toContainText("Original phrase");
    await expect(commenterEditor).toHaveAttribute("contenteditable", "false");

    await commenter.locator(`#node-${runNodeID}`).evaluate((run) => {
      const text = run.firstChild!;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, text.textContent!.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await commenter.getByRole("button", { name: "Suggest change" }).click();
    await commenter.getByLabel("Proposed text").fill("Proposed phrase");
    await commenter.getByRole("button", { name: "Submit suggestion" }).click();
    await expect(commenter.getByText("pending · human")).toBeVisible();
    await expect(commenterEditor).toContainText("Original phrase");
    await expect(commenterEditor).not.toContainText("Proposed phrase");
    await expect(commenter.getByRole("button", { name: "Accept" })).toHaveCount(
      0,
    );

    await page.goto(`/docs/${documentID}`);
    await expect(page.locator(".ProseMirror")).toContainText("Original phrase");
    await page
      .getByRole("button", { name: "Suggestions", exact: true })
      .click();
    await expect(page.getByText("pending · human")).toBeVisible();
    await page.getByRole("button", { name: "Accept" }).click();
    await expect(page.locator(".ProseMirror")).toContainText("Proposed phrase");
    await expect(commenterEditor).toContainText("Proposed phrase");
  } finally {
    await commenterContext.close();
  }
});
