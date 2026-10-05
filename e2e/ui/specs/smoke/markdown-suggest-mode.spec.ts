import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createdDocumentID, documentPayload, storedNodes } from "../../helpers/markdown-document";

test("@live @smoke @suggestlive: a commenter's typing is a suggestion in the document that the owner accepts or rejects", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const suffix = randomUUID();
  const workspaceName = `Suggestion workspace ${suffix}`;
  let documentID = "";
  const rootNodeID = randomUUID();
  const paragraphNodeID = randomUUID();
  const runNodeID = randomUUID();
  const commenterEmail = `suggestion-${suffix}@example.invalid`;
  const viewerEmail = `suggestion-viewer-${suffix}@example.invalid`;
  const commenterPassword = "password12345678";
  const viewerPassword = "password12345678";
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
  const canonicalRuns = async () => {
    const response = { json: async () => ({ data: { nodes: await storedNodes(page, documentID, ownerHeaders) } }) };
    const data = (await response.json()) as {
      data: { nodes: { type: string; content: string }[] };
    };
    return data.data.nodes
      .filter((node) => node.type === "run")
      .map((node) => node.content);
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
  const legacyProposal = await page.request.post(
    `${apiURL}/api/v1/documents/${documentID}/suggestions`,
    { headers: ownerHeaders, data: {} },
  );
  expect(legacyProposal.status()).toBe(405);

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
        fullName: "Suggestion Viewer",
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
    await commenter
      .getByRole("button", { name: "Review", exact: true })
      .click();
    expect(
      await commenter.getByRole("button", { name: /^Suggest/ }).count(),
    ).toBe(0);

    // The owner opens the same document and watches.
    await page.goto(`/docs/${documentID}`);
    const ownerEditor = page.locator(".ProseMirror");
    await expect(ownerEditor).toContainText("Original phrase");
    await expect(page.getByRole("status")).toContainText("Synced");
    await page.getByRole("button", { name: "Review", exact: true }).click();
    const ownerCards = page.getByRole("list", {
      name: "Suggestions and comments",
    });

    // Add: typing at the end is one suggestion, shown in place to both.
    await commenterEditor.getByText("Original phrase").click();
    await commenter.keyboard.press("End");
    await commenter.keyboard.type("!!");
    await expect(commenterEditor.locator(".suggest-ins")).toHaveText("!!");
    await expect(ownerEditor.locator(".suggest-ins")).toHaveText("!!");
    await expect(ownerCards).toContainText('Add: "!!"');

    // Replace: delete a word, type another right there.
    await commenterEditor.getByText("Original phrase").click();
    const selectedText = await commenterEditor.evaluate((editor) => {
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      let content = "";
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (!node.data) continue;
        nodes.push(node);
        content += node.data;
      }

      const text = "Original";
      const start = content.indexOf(text);
      if (start < 0) throw new Error(`Could not find ${text}`);
      const point = (offset: number): [Text, number] => {
        let length = 0;
        for (const node of nodes) {
          if (offset <= length + node.length) return [node, offset - length];
          length += node.length;
        }
        throw new Error(`Could not place selection at ${offset}`);
      };
      const [startNode, startOffset] = point(start);
      const [endNode, endOffset] = point(start + text.length);
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return selection?.toString() ?? "";
    });
    expect(selectedText).toBe("Original");
    await commenter.keyboard.press("Backspace");
    await commenter.keyboard.type("Changed");
    await expect(ownerCards).toContainText(
      'Replace: "Original" with "Changed"',
    );
    const replaceCard = ownerCards
      .locator("li")
      .filter({ hasText: "Replace:" });
    await expect(replaceCard).toContainText("Suggestion Commenter");
    await expect(replaceCard.locator("time[datetime]")).toHaveAttribute(
      "datetime",
      /^\d{4}-\d{2}-\d{2}T/,
    );
    const replaceID = await replaceCard.getAttribute("data-suggestion-id");
    const avatarColor = await replaceCard
      .locator('[data-slot="avatar"]')
      .evaluate((avatar) => getComputedStyle(avatar).borderTopColor);
    const suggestionColor = await ownerEditor
      .locator(`.suggest-ins[data-suggestion-id="${replaceID}"]`)
      .evaluate((mark) => getComputedStyle(mark).textDecorationColor);
    expect(avatarColor).toBe(suggestionColor);
    const showSuggestion = replaceCard.getByRole("button", {
      name: /^Show in document:/,
    });
    await expect(showSuggestion).toBeVisible();
    await expect.poll(canonicalRuns).toEqual(["Original phrase"]);
    const highlightedText = ownerEditor.locator(
      `[data-suggestion-id="${replaceID}"]`,
    );
    await expect(highlightedText.first()).toBeVisible();
    await showSuggestion.click();
    await expect.poll(canonicalRuns).toEqual(["Original phrase"]);
    await expect(replaceCard).toContainText(
      'Replace: "Original" with "Changed"',
    );
    const focusedText = ownerEditor.locator(
      `[data-suggestion-focus-id="${replaceID}"]`,
    );
    await expect(focusedText).toHaveCount(2);
    await expect(focusedText.first()).toHaveClass(/suggestion-focus/);
    await expect(
      ownerEditor.locator(`.suggest-ins[data-suggestion-id="${replaceID}"]`),
    ).toContainText("Changed");
    await ownerEditor
      .locator(`.suggest-ins[data-suggestion-id="${replaceID}"]`)
      .click();
    await expect(replaceCard).toHaveAttribute("data-focused", "true");
    await expect.poll(canonicalRuns).toEqual(["Original phrase"]);
    await page.getByRole("button", { name: "Preview accepted" }).click();
    await expect(ownerEditor.locator(".suggest-del")).toBeHidden();
    await expect(ownerEditor.locator(".suggest-ins").first()).toBeVisible();
    await page.getByRole("button", { name: "Preview rejected" }).click();
    await expect(ownerEditor.locator(".suggest-ins").first()).toBeHidden();
    await expect(ownerEditor.locator(".suggest-del")).toBeVisible();
    await page.getByRole("button", { name: "Show suggestions" }).click();

    await page.setViewportSize({ width: 375, height: 800 });
    await expect(ownerCards).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 1280, height: 720 });

    // Suggestions stay out of the canonical body until accepted.
    await expect.poll(canonicalRuns).toEqual(["Original phrase"]);

    // Reject the Add, accept the Replace.
    const addCard = ownerCards.locator("li").filter({ hasText: 'Add: "!!"' });
    await addCard.getByRole("button", { name: "Reject" }).click();
    await expect(ownerEditor.locator(".suggest-ins")).toHaveCount(1);
    await expect(commenterEditor).not.toContainText("!!");

    await replaceCard.getByRole("button", { name: "Accept" }).click();
    // With no suggestions left the list gives way to its empty message.
    await expect(page.getByText("Replace:")).toHaveCount(0);
    await expect(ownerEditor).toContainText("Changed phrase");
    await expect(commenterEditor).toContainText("Changed phrase");
    await expect.poll(canonicalRuns).toEqual(["Changed phrase"]);

    // A reload agrees.
    await page.reload();
    await expect(page.locator(".ProseMirror")).toContainText("Changed phrase");
    await expect(page.locator(".ProseMirror .suggest-ins")).toHaveCount(0);

    // The commenter can only withdraw their own, not decide.
    const commenterReview = commenter.getByRole("button", {
      name: "Review",
      exact: true,
    });
    if ((await commenterReview.getAttribute("aria-expanded")) !== "true") {
      await commenterReview.click();
    }
    await commenterEditor.getByText("Changed phrase").click();
    await commenter.keyboard.press("End");
    await commenter.keyboard.type("?");
    const commenterCards = commenter.getByRole("list", {
      name: "Suggestions and comments",
    });
    await expect(commenterCards).toContainText('Add: "?"');
    await expect(
      commenterCards.getByRole("button", { name: "Accept" }),
    ).toHaveCount(0);

    const viewer = await viewerContext.newPage();
    await viewer.goto("/sign-in");
    await viewer.locator('input[name="email"]').fill(viewerEmail);
    await viewer.locator('input[name="password"]').fill(viewerPassword);
    await viewer.getByRole("button", { name: /sign in/i }).click();
    await viewer.waitForURL((url) => url.pathname === "/");
    await viewer.goto(`/docs/${documentID}`);
    const viewerEditor = viewer.locator(".ProseMirror");
    await expect(viewerEditor.locator(".suggest-ins")).toHaveText("?");
    await viewer.getByRole("button", { name: "Review", exact: true }).click();
    await expect(
      viewer.getByRole("complementary", { name: "Review" }),
    ).toBeVisible();
    const viewerCards = viewer.getByRole("list", {
      name: "Suggestions and comments",
    });
    await expect(viewerCards).toContainText('Add: "?"');
    await viewer.getByRole("button", { name: "Preview rejected" }).click();
    await expect(viewer.locator(".markdown-body")).toHaveAttribute(
      "data-suggestion-preview",
      "rejected",
    );
    await expect(viewerEditor.locator(".suggest-ins").first()).toBeHidden();
    await viewer.getByRole("button", { name: "Show suggestions" }).click();
    await expect(viewerEditor).toHaveAttribute("contenteditable", "false");
    await expect(viewerEditor.locator(".suggest-ins").first()).toBeVisible();
    await expect(
      viewerCards.getByRole("button", { name: /^(accept|reject|withdraw)$/i }),
    ).toHaveCount(0);
    await expect(viewerCards.getByLabel("Reply")).toHaveCount(0);
    await expect(
      viewerCards.getByRole("button", { name: /resolve discussion/i }),
    ).toHaveCount(0);

    const ownerReview = page.getByRole("button", {
      name: "Review",
      exact: true,
    });
    if ((await ownerReview.getAttribute("aria-expanded")) !== "true") {
      await ownerReview.click();
    }
    const liveCard = ownerCards.locator("li").filter({ hasText: 'Add: "?"' });
    await expect(liveCard).toBeVisible();
    await liveCard.getByLabel("Reply").fill("Please keep this change.");
    await liveCard.getByRole("button", { name: "Send reply" }).click();
    await expect(liveCard).toContainText("Please keep this change.");

    await page.getByRole("button", { name: "Accept all", exact: true }).click();
    const acceptAllDialog = page.getByRole("alertdialog");
    await expect(acceptAllDialog).toContainText("Accept all 1 suggestion?");
    await acceptAllDialog
      .getByRole("button", { name: "Accept all", exact: true })
      .click();
    await expect(
      page.getByText(/No suggestions or comments yet/),
    ).toBeVisible();
    await expect(ownerEditor).toContainText("Changed phrase?");
    await expect.poll(canonicalRuns).toEqual(["Changed phrase?"]);

    await commenterEditor.getByText("Changed phrase?").click();
    await commenter.keyboard.press("Home");
    await commenter.keyboard.type("!");
    await expect(ownerCards).toContainText('Add: "!"');
    await page.getByRole("button", { name: "Reject all", exact: true }).click();
    const rejectAllDialog = page.getByRole("alertdialog");
    await expect(rejectAllDialog).toContainText("Reject all 1 suggestion?");
    await rejectAllDialog
      .getByRole("button", { name: "Reject all", exact: true })
      .click();
    await expect(
      page.getByText(/No suggestions or comments yet/),
    ).toBeVisible();
    await expect(ownerEditor).toContainText("Changed phrase?");
    await expect.poll(canonicalRuns).toEqual(["Changed phrase?"]);

    await commenterEditor.getByText("Changed phrase?").click();
    await commenter.keyboard.press("End");
    await commenter.keyboard.type("?");
    await expect(commenterCards).toContainText('Add: "?"');

    await commenterCards
      .locator("li")
      .filter({ hasText: 'Add: "?"' })
      .last()
      .getByRole("button", { name: "Withdraw" })
      .click();
    await expect(commenterEditor.locator(".suggest-ins")).toHaveCount(0);
    await expect(commenterEditor).toContainText("Changed phrase?");
    await expect.poll(canonicalRuns).toEqual(["Changed phrase?"]);
  } finally {
    await viewerContext.close();
    await commenterContext.close();
  }
});
