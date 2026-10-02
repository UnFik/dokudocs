import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("@live: typing in Suggest mode becomes a pending suggestion that an editor can accept", async ({
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
    await commenter.setViewportSize({ width: 375, height: 800 });
    await commenter.goto(`/docs/${documentID}`);
    const commenterEditor = commenter.locator(".ProseMirror");
    await expect(commenterEditor).toContainText("Original phrase");

    const tab = (name: string) =>
      commenter.getByRole("tab", { name, exact: true });
    await expect(tab("View")).toHaveAttribute("aria-selected", "true");
    await expect(tab("Edit")).toHaveAttribute("aria-disabled", "true");
    await expect(tab("Suggest")).not.toHaveAttribute("aria-disabled", "true");

    await tab("Suggest").click();
    await expect(commenterEditor).toHaveAttribute("contenteditable", "true");
    await expect(
      commenter.getByRole("complementary", { name: "Suggestions" }),
    ).toBeVisible();

    await commenterEditor.getByText("Original phrase").click();
    await commenter.keyboard.press("End");
    await commenter.keyboard.type("!");
    // The typed text shows in place at once as a suggestion layer.
    await expect(commenterEditor.locator(".suggest-ins")).toHaveText("!");
    // Moving the caret saves it as one suggestion.
    await commenter.keyboard.press("Home");
    await expect(commenter.getByText("pending · human")).toBeVisible();
    await expect(commenter.getByText("Insert “!”")).toBeVisible();

    await commenter.keyboard.press("Enter");
    await expect(
      commenter.getByText(/Typing can only change text within one block/),
    ).toBeVisible();

    const overflow = await commenter.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await commenter.reload();
    await expect(tab("Suggest")).toHaveAttribute("aria-selected", "true");
    await expect(
      commenter.getByRole("complementary", { name: "Suggestions" }),
    ).toBeVisible();

    await page.goto(`/docs/${documentID}`);
    const ownerEditor = page.locator(".ProseMirror");
    await expect(ownerEditor).toContainText("Original phrase");
    await expect(ownerEditor.locator(".suggest-ins")).toHaveText("!");
    for (const name of ["View", "Edit", "Suggest"]) {
      await expect(
        page.getByRole("tab", { name, exact: true }),
      ).not.toHaveAttribute("aria-disabled", "true");
    }
    await page
      .getByRole("button", { name: "Suggestions", exact: true })
      .click();
    await page.getByRole("button", { name: "Accept" }).click();
    await expect(ownerEditor.locator(".suggest-ins")).toHaveCount(0);
    await expect(ownerEditor).toContainText("Original phrase!");
    await expect(commenterEditor).toContainText("Original phrase!");
  } finally {
    await commenterContext.close();
  }
});
