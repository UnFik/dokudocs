import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("@live @smoke @suggestlive: a commenter's typing is a suggestion in the document that the owner accepts or rejects", async ({
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

    const tab = (name: string) =>
      commenter.getByRole("tab", { name, exact: true });
    await expect(tab("Edit")).toHaveAttribute("aria-disabled", "true");
    await expect(tab("Suggest")).not.toHaveAttribute("aria-disabled", "true");
    await tab("Suggest").click();
    await expect(commenterEditor).toHaveAttribute("contenteditable", "true");
    await expect(commenter.getByRole("status")).toContainText("Synced");

    // The owner opens the same document and watches.
    await page.goto(`/docs/${documentID}`);
    const ownerEditor = page.locator(".ProseMirror");
    await expect(ownerEditor).toContainText("Original phrase");
    await expect(page.getByRole("status")).toContainText("Synced");
    await page
      .getByRole("button", { name: "Suggestions", exact: true })
      .click();
    const ownerCards = page.getByRole("list", {
      name: "Suggestions in this document",
    });

    // Add: typing at the end is one suggestion, shown in place to both.
    await commenterEditor.getByText("Original phrase").click();
    await commenter.keyboard.press("End");
    await commenter.keyboard.type("!!");
    await expect(commenterEditor.locator(".suggest-ins")).toHaveText("!!");
    await expect(ownerEditor.locator(".suggest-ins")).toHaveText("!!");
    await expect(ownerCards).toContainText('Add: "!!"');

    // Replace: delete a word, type another right there.
    await commenter.evaluate(() => {
      const run = [...document.querySelectorAll(".ProseMirror span")].find(
        (span) => span.textContent?.startsWith("Original phrase"),
      )!;
      const text = run.firstChild!;
      window.getSelection()!.setBaseAndExtent(text, 0, text, 8);
    });
    await commenter.keyboard.type("Changed");
    await expect(ownerCards).toContainText(
      'Replace: "Original" with "Changed"',
    );

    await page.setViewportSize({ width: 375, height: 800 });
    await expect(ownerCards).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 1280, height: 720 });

    // Suggestions stay out of the canonical body until accepted.
    const apiBody = async () => {
      const response = await page.request.get(
        `${apiURL}/api/v1/documents/${documentID}/body`,
        { headers: ownerHeaders },
      );
      const data = (await response.json()) as {
        data: { nodes: { type: string; content: string }[] };
      };
      return data.data.nodes
        .filter((n) => n.type === "run")
        .map((n) => n.content);
    };
    await expect.poll(apiBody).toEqual(["Original phrase"]);

    // Reject the Add, accept the Replace.
    const addCard = ownerCards.locator("li").filter({ hasText: 'Add: "!!"' });
    await addCard.getByRole("button", { name: "Reject" }).click();
    await expect(ownerEditor.locator(".suggest-ins")).toHaveCount(1);
    await expect(commenterEditor).not.toContainText("!!");

    const replaceCard = ownerCards
      .locator("li")
      .filter({ hasText: "Replace:" });
    await replaceCard.getByRole("button", { name: "Accept" }).click();
    // With no suggestions left the list gives way to its empty message.
    await expect(page.getByText("Replace:")).toHaveCount(0);
    await expect(ownerEditor).toContainText("Changed phrase");
    await expect(commenterEditor).toContainText("Changed phrase");
    await expect.poll(apiBody).toEqual(["Changed phrase"]);

    // A reload agrees.
    await page.reload();
    await expect(page.locator(".ProseMirror")).toContainText("Changed phrase");
    await expect(page.locator(".ProseMirror .suggest-ins")).toHaveCount(0);

    // The commenter can only withdraw their own, not decide.
    await commenterEditor.getByText("Changed phrase").click();
    await commenter.keyboard.press("End");
    await commenter.keyboard.type("?");
    const commenterCards = commenter.getByRole("list", {
      name: "Suggestions in this document",
    });
    await expect(commenterCards).toContainText('Add: "?"');
    await expect(
      commenterCards.getByRole("button", { name: "Accept" }),
    ).toHaveCount(0);
    await commenterCards.getByRole("button", { name: "Withdraw" }).click();
    await expect(commenterEditor.locator(".suggest-ins")).toHaveCount(0);
    await expect(commenterEditor).toContainText("Changed phrase");
    await expect.poll(apiBody).toEqual(["Changed phrase"]);
  } finally {
    await commenterContext.close();
  }
});
