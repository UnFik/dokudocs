import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createdDocumentID, documentPayload, storedNodes } from "../../helpers/markdown-document";

test("@live @smoke @comments: a commenter's comment reaches the owner at once, is replied to, resolved, and survives the text it was about", async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  const suffix = randomUUID();
  const workspaceName = `Suggestion workspace ${suffix}`;
  let documentID = "";
  const rootNodeID = randomUUID();
  const paragraphNodeID = randomUUID();
  const runNodeID = randomUUID();
  const commenterEmail = `suggestion-${suffix}@example.invalid`;
  const viewerEmail = `comment-viewer-${suffix}@example.invalid`;
  const viewerPassword = "password12345678";
  const commenterPassword = "password12345678";
  const apiURL = process.env.API_URL ?? "http://localhost:8080";

  await page.goto("/sign-in");
  await page.locator('input[name="email"]').fill("admin@example.com");
  await page.locator('input[name="password"]').fill("password123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname === "/dashboard");
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
  const canonicalRuns = async () => {
    const response = { json: async () => ({ data: { nodes: await storedNodes(page, documentID, ownerHeaders) } }) };
    const data = (await response.json()) as {
      data: {
        nodes: {
          nodeID: string;
          parentID: string | null;
          siblingOrder: number;
          type: string;
          content: string;
        }[];
      };
    };
    // The API does not promise a row order, so walk the tree in document order.
    const nodes = data.data.nodes;
    const walk = (parentID: string | null): string[] =>
      nodes
        .filter((node) => node.parentID === parentID)
        .sort((a, b) => a.siblingOrder - b.siblingOrder)
        .flatMap((node) =>
          node.type === "run" ? [node.content] : walk(node.nodeID),
        );
    return walk(null);
  };
  const createResponse = await page.request.post(`${apiURL}/api/v1/documents`, {
    headers: { ...ownerHeaders, "Idempotency-Key": randomUUID() },
    data: {
      title: `Suggestion document ${suffix}`,
      type: "markdown",
      visibility: "private",
      ...documentPayload([
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
        ]),
    },
  });
  expect(createResponse.status()).toBe(201);
  documentID = await createdDocumentID(createResponse);

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

  const viewerRegisterResponse = await page.request.post(
    `${apiURL}/api/v1/auth/register`,
    {
      data: {
        email: viewerEmail,
        password: viewerPassword,
        fullName: "Comment Viewer",
      },
    },
  );
  expect(viewerRegisterResponse.status()).toBe(201);
  const viewerInviteResponse = await page.request.post(
    `${apiURL}/api/v1/workspaces/${workspaceID}/invites`,
    { headers: ownerHeaders, data: { email: viewerEmail, role: "member" } },
  );
  expect(viewerInviteResponse.status()).toBe(201);
  const viewerGrantResponse = await page.request.post(
    `${apiURL}/api/v1/documents/${documentID}/accesses`,
    {
      headers: ownerHeaders,
      data: { email: viewerEmail, level: "view" },
    },
  );
  expect(viewerGrantResponse.status()).toBe(201);

  const commenterContext = await browser.newContext();
  const viewerContext = await browser.newContext();
  try {
    const signIn = async (
      context: typeof commenterContext,
      email: string,
      password: string,
    ) => {
      const next = await context.newPage();
      await next.goto("/sign-in");
      await next.locator('input[name="email"]').fill(email);
      await next.locator('input[name="password"]').fill(password);
      await next.getByRole("button", { name: /sign in/i }).click();
      await next.waitForURL((url) => url.pathname === "/dashboard");
      await next.goto(`/docs/${documentID}`);
      return next;
    };
    const commenter = await signIn(
      commenterContext,
      commenterEmail,
      commenterPassword,
    );
    const commenterEditor = commenter.locator(".ProseMirror");
    await expect(commenterEditor).toContainText("Original phrase");
    await commenter.getByRole("button", { name: /^Editor mode/ }).click();
  await commenter.getByRole("menuitemradio", { name: "Suggest", exact: true }).click();
    await expect(commenter.getByRole("status")).toContainText("Synced");

    await page.goto(`/docs/${documentID}`);
    const ownerEditor = page.locator(".ProseMirror");
    await expect(ownerEditor).toContainText("Original phrase");
    await expect(page.getByRole("status")).toContainText("Synced");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    const ownerRail = page.getByRole("list", {
      name: "Suggestions and comments",
    });
    const commenterRail = commenter.getByRole("list", {
      name: "Suggestions and comments",
    });

    // Select a word with the keyboard and press the comment shortcut.
    const selectWord = async (word: string) => {
      // Re-drawn marks can swallow a key press, so check what is selected and
      // try again rather than comment on the wrong words.
      await expect(async () => {
        await commenterEditor.getByText("Original phrase").click();
        await commenter.keyboard.press("Home");
        const index = "Original phrase".indexOf(word);
        for (let step = 0; step < index; step++)
          await commenter.keyboard.press("ArrowRight");
        for (let step = 0; step < word.length; step++)
          await commenter.keyboard.press("Shift+ArrowRight");
        expect(
          await commenter.evaluate(() => window.getSelection()?.toString()),
        ).toBe(word);
      }).toPass({ timeout: 15_000 });
    };
    await selectWord("Original");
    await commenter.keyboard.press("Control+Alt+m");
    const newCard = commenter.locator("li[data-new-comment]");
    await expect(newCard).toContainText("Original");
    await newCard
      .getByLabel("Comment", { exact: true })
      .fill("Is this the right title?");
    await newCard.getByRole("button", { name: "Comment", exact: true }).click();

    // The owner sees the thread and the marked words without reloading.
    await expect(ownerRail).toContainText("Is this the right title?");
    await expect(ownerRail).toContainText("Suggestion Commenter");
    await expect(ownerEditor.locator(".comment-mark")).toHaveText("Original");
    await expect(commenterEditor.locator(".comment-mark")).toHaveText(
      "Original",
    );
    await expect.poll(canonicalRuns).toEqual(["Original phrase"]);

    // Clicking the card focuses the words; clicking the words focuses the card.
    const ownerThread = page.locator("li[data-comment-thread-id]").first();
    await ownerThread
      .getByRole("button", { name: /^Show in document:/ })
      .click();
    await expect(ownerEditor.locator(".comment-focus")).toHaveText("Original");
    await expect(ownerThread).toHaveAttribute("data-focused", "true");

    // The chosen card shows its reply box; the owner replies and the commenter sees it live.
    await ownerThread.getByLabel("Reply").fill("Yes, keep it.");
    await ownerThread.getByRole("button", { name: "Send reply" }).click();
    await expect(commenterRail).toContainText("Yes, keep it.");

    // The author edits their comment; others see it, marked as edited.
    const commenterThread = commenter
      .locator("li[data-comment-thread-id]")
      .first();
    await commenterThread
      .getByRole("button", { name: "Edit this comment" })
      .click();
    await commenterThread
      .getByLabel("Edit comment")
      .fill("Is this the right title? (edited)");
    await commenterThread.getByRole("button", { name: "Save" }).click();
    await expect(ownerThread).toContainText(
      "Is this the right title? (edited)",
    );
    await expect(ownerThread).toContainText("edited");
    // Nobody else gets Edit on it; the owner may still delete a reply of their own.
    await expect(
      ownerThread.getByRole("button", { name: "Edit this comment" }),
    ).toHaveCount(0);
    await ownerThread.getByRole("button", { name: "Delete reply" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(commenterRail).not.toContainText("Yes, keep it.");

    // Resolving removes the marks for both and tucks the thread away.
    await ownerThread.getByRole("button", { name: "Resolve comment" }).click();
    await expect(ownerEditor.locator(".comment-mark")).toHaveCount(0);
    await expect(commenterEditor.locator(".comment-mark")).toHaveCount(0);
    await expect(
      commenter.getByRole("button", { name: "Show 1 resolved comment" }),
    ).toBeVisible();
    await expect(commenterRail).toHaveCount(0);
    await commenter
      .getByRole("button", { name: "Show 1 resolved comment" })
      .click();
    await expect(commenterRail).toContainText("Is this the right title?");

    // A second thread is orphaned when an editor deletes its words.
    await selectWord("phrase");
    await commenter.keyboard.press("Control+Alt+m");
    await commenter
      .locator("li[data-new-comment]")
      .getByLabel("Comment", { exact: true })
      .fill("Is this word needed?");
    await commenter
      .locator("li[data-new-comment]")
      .getByRole("button", { name: "Comment", exact: true })
      .click();
    await expect(ownerEditor.locator(".comment-mark")).toHaveText("phrase");
    await expect(async () => {
      await ownerEditor.getByText("phrase").dblclick();
      expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
        "phrase",
      );
    }).toPass({ timeout: 15_000 });
    // The click has been handled once the thread's card is focused.
    await expect(
      page
        .locator("li[data-comment-thread-id]")
        .filter({ hasText: "Is this word needed?" }),
    ).toHaveAttribute("data-focused", "true");
    await page.keyboard.press("Backspace");
    await expect(ownerEditor).not.toContainText("phrase");
    const orphan = page.locator("li[data-comment-thread-id]").filter({
      hasText: "Is this word needed?",
    });
    await expect(orphan).toContainText("text changed");
    await expect(
      commenter
        .locator("li[data-comment-thread-id]")
        .filter({ hasText: "Is this word needed?" }),
    ).toContainText("text changed");

    // Someone who can only view reads the threads and cannot add to them.
    const viewer = await signIn(viewerContext, viewerEmail, viewerPassword);
    await viewer.getByRole("button", { name: "Comment", exact: true }).click();
    const viewerRail = viewer.getByRole("list", {
      name: "Suggestions and comments",
    });
    await expect(viewerRail).toContainText("Is this word needed?");
    // The info line's Comment button only opens this panel; nothing in the panel adds a comment.
    await expect(
      viewerRail.getByRole("button", { name: "Comment", exact: true }),
    ).toHaveCount(0);
    await expect(viewerRail.getByLabel("Reply")).toHaveCount(0);
    await expect(
      viewerRail.getByRole("button", { name: /resolve comment/i }),
    ).toHaveCount(0);

    // A reload agrees, and the rail fits a phone.
    await page.reload();
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(
      page.getByRole("list", { name: "Suggestions and comments" }),
    ).toContainText("Is this word needed?");
    await page.setViewportSize({ width: 375, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);

    // An editor can delete anyone's thread, after a confirmation.
    const toDelete = page
      .locator("li[data-comment-thread-id]")
      .filter({ hasText: "Is this word needed?" });
    await expect(toDelete).toBeVisible();
    await toDelete.getByRole("button", { name: "Delete", exact: true }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(
      page
        .locator("li[data-comment-thread-id]")
        .filter({ hasText: "Is this word needed?" }),
    ).toHaveCount(0);
    await expect(
      commenter
        .locator("li[data-comment-thread-id]")
        .filter({ hasText: "Is this word needed?" }),
    ).toHaveCount(0);
  } finally {
    await commenterContext.close();
    await viewerContext.close();
  }
});
