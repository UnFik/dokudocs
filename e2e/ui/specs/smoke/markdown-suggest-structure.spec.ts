import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createdDocumentID, documentPayload, storedNodes } from "../../helpers/markdown-document";

test("@live @smoke @suggeststructure: a commenter's Enter and multi-line paste are suggestions the owner accepts or rejects", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const suffix = randomUUID();
  const workspaceName = `Suggestion workspace ${suffix}`;
  let documentID = "";
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

  const commenterContext = await browser.newContext();
  try {
    const commenter = await commenterContext.newPage();
    await commenter.goto("/sign-in");
    await commenter.locator('input[name="email"]').fill(commenterEmail);
    await commenter.locator('input[name="password"]').fill(commenterPassword);
    await commenter.getByRole("button", { name: /sign in/i }).click();
    await commenter.waitForURL((url) => url.pathname === "/dashboard");
    await commenter.goto(`/docs/${documentID}`);
    const commenterEditor = commenter.locator(".ProseMirror");
    await expect(commenterEditor).toContainText("Original phrase");
    await commenter.getByRole("button", { name: /^Editor mode/ }).click();
  await commenter.getByRole("menuitemradio", { name: "Suggest", exact: true }).click();
    await expect(commenterEditor).toHaveAttribute("contenteditable", "true");
    await expect(commenter.getByRole("status")).toContainText("Synced");

    await page.goto(`/docs/${documentID}`);
    const ownerEditor = page.locator(".ProseMirror");
    await expect(ownerEditor).toContainText("Original phrase");
    await expect(page.getByRole("status")).toContainText("Synced");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    const ownerCards = page.getByRole("list", {
      name: "Suggestions and comments",
    });

    const openReview = async () => {
      const review = page.getByRole("button", { name: "Comment", exact: true });
      if ((await review.getAttribute("aria-expanded")) !== "true")
        await review.click();
    };

    // Enter at the end of the paragraph, then typing: one Add, in place for both.
    await commenterEditor.getByText("Original phrase").click();
    await commenter.keyboard.press("End");
    await commenter.keyboard.press("Enter");
    await commenter.keyboard.type("Second line");
    await expect(ownerCards).toContainText('Add: “Second line”');
    await expect(ownerEditor.locator("p")).toHaveCount(2);
    await expect.poll(canonicalRuns).toEqual(["Original phrase"]);

    // The owner accepts: the paragraph is part of the document.
    await ownerCards.getByRole("button", { name: "Accept" }).click();
    await expect(
      page.getByText(/No suggestions or comments yet/),
    ).toBeVisible();
    await expect
      .poll(canonicalRuns)
      .toEqual(["Original phrase", "Second line"]);
    await expect(commenterEditor.locator("p")).toHaveCount(2);

    // A multi-line paste at the end of the last paragraph, then rejected.
    await commenterEditor.getByText("Second line").click();
    await commenter.keyboard.press("End");
    await commenter.evaluate(() => {
      const data = new DataTransfer();
      data.setData("text/plain", " A\nB");
      document.querySelector(".ProseMirror")!.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await expect(ownerEditor.locator("p")).toHaveCount(3);
    await expect(ownerCards.locator("li")).toHaveCount(1);
    await expect
      .poll(canonicalRuns)
      .toEqual(["Original phrase", "Second line"]);
    await ownerCards.getByRole("button", { name: "Reject" }).click();
    await expect(
      page.getByText(/No suggestions or comments yet/),
    ).toBeVisible();
    await expect(ownerEditor.locator("p")).toHaveCount(2);
    await expect(commenterEditor.locator("p")).toHaveCount(2);

    // Backspace at the start of the second paragraph joins it with the first.
    await commenterEditor.getByText("Second line").click();
    await commenter.keyboard.press("Home");
    await commenter.keyboard.press("Backspace");
    await openReview();
    await expect(ownerCards).toContainText("Join paragraphs");
    await expect
      .poll(canonicalRuns)
      .toEqual(["Original phrase", "Second line"]);
    await ownerCards.getByRole("button", { name: "Accept" }).click();
    await expect(ownerCards).toHaveCount(0);
    await expect(ownerEditor.locator("p")).toHaveCount(1);
    await expect(commenterEditor.locator("p")).toHaveCount(1);
    await expect(ownerEditor).toContainText("Original phraseSecond line");

    // Enter in the middle of the text splits it again, and the owner rejects.
    await commenterEditor.getByText("Original phrase").click();
    await commenter.keyboard.press("Home");
    for (let index = 0; index < 8; index++)
      await commenter.keyboard.press("ArrowRight");
    await commenter.keyboard.press("Enter");
    await openReview();
    await expect(ownerCards).toContainText("Split paragraph");
    await expect(ownerEditor.locator("p")).toHaveCount(2);
    await ownerCards.getByRole("button", { name: "Reject" }).click();
    await expect(ownerCards).toHaveCount(0);
    await expect(ownerEditor.locator("p")).toHaveCount(1);
    await expect(commenterEditor.locator("p")).toHaveCount(1);

    // Split again and accept: two paragraphs in the canonical body.
    await commenterEditor.getByText("Original phrase").click();
    await commenter.keyboard.press("Home");
    for (let index = 0; index < 8; index++)
      await commenter.keyboard.press("ArrowRight");
    await commenter.keyboard.press("Enter");
    await openReview();
    await expect(ownerCards).toContainText("Split paragraph");
    await ownerCards.getByRole("button", { name: "Accept" }).click();
    await expect(ownerCards).toHaveCount(0);
    await expect(ownerEditor.locator("p")).toHaveCount(2);
    await expect
      .poll(canonicalRuns)
      .toEqual(["Original", " phrase", "Second line"]);

    // Bold on a selection is a Format suggestion: the text keeps its look until
    // the owner accepts, and the preview shows the result.
    const selectOriginal = async () => {
      // Check what is selected, so a lost key press cannot suggest the wrong words.
      await expect(async () => {
        await commenterEditor.getByText("Original").first().click();
        await commenter.keyboard.press("Home");
        for (let index = 0; index < 8; index++)
          await commenter.keyboard.press("Shift+ArrowRight");
        expect(
          await commenter.evaluate(() => window.getSelection()?.toString()),
        ).toBe("Original");
      }).toPass({ timeout: 15_000 });
    };
    await selectOriginal();
    await commenter.keyboard.press("Control+b");
    await openReview();
    await expect(ownerCards).toContainText('Format: bold “Original”');
    await expect(ownerEditor.locator("strong")).toHaveCount(0);
    await expect(ownerEditor.locator(".suggest-fmt")).toContainText("Original");
    await page.getByRole("button", { name: "Preview accepted" }).click();
    await expect(ownerEditor.locator(".suggest-fmt-bold").first()).toHaveCSS(
      "font-weight",
      "700",
    );
    await page.getByRole("button", { name: "Show suggestions" }).click();
    await ownerCards.getByRole("button", { name: "Accept" }).click();
    await expect(ownerEditor.locator("strong")).toHaveText("Original");
    await expect(commenterEditor.locator("strong")).toHaveText("Original");
    await expect(ownerEditor.locator(".suggest-fmt")).toHaveCount(0);

    // Italic is proposed and rejected: nothing changes.
    await selectOriginal();
    await commenter.keyboard.press("Control+i");
    await openReview();
    await expect(ownerCards).toContainText('Format: italic “Original”');
    await ownerCards.getByRole("button", { name: "Reject" }).click();
    await expect(ownerCards).toHaveCount(0);
    await expect(ownerEditor.locator("em")).toHaveCount(0);
    await expect(commenterEditor.locator("em")).toHaveCount(0);
    await expect(commenterEditor.locator(".suggest-fmt")).toHaveCount(0);

    // A link on a selection is proposed too, and accepting links the words.
    await selectOriginal();
    await commenter.getByRole("button", { name: "Link", exact: true }).click();
    await commenter
      .getByLabel("Link address")
      .fill("https://example.com/title");
    await commenter.getByRole("button", { name: "Apply link" }).click();
    await openReview();
    await expect(ownerCards).toContainText('Format: link “Original”');
    await expect(ownerEditor.locator("[data-link-href]")).toHaveCount(0);
    await ownerCards.getByRole("button", { name: "Accept" }).click();
    await expect(
      ownerEditor.locator('[data-link-href="https://example.com/title"]'),
    ).toHaveText("Original");
    await expect(
      commenterEditor.locator('[data-link-href="https://example.com/title"]'),
    ).toHaveText("Original");

    // A reload agrees.
    await page.reload();
    await expect(page.locator(".ProseMirror p")).toHaveCount(2);
    await expect(page.locator(".ProseMirror .suggest-ins")).toHaveCount(0);
    await expect(page.locator(".ProseMirror strong")).toHaveText("Original");
    await expect
      .poll(canonicalRuns)
      .toEqual(["Original", " phrase", "Second line"]);

    // A block's type is proposed too: the block keeps its look until accepted.
    await commenterEditor.getByText("Original").first().click();
    await commenter.keyboard.press("Control+Alt+2");
    await openReview();
    await expect(ownerCards).toContainText('Format: heading 2 “Original”');
    await expect(ownerEditor.locator("h2")).toHaveCount(0);
    await expect(ownerEditor.locator(".suggest-block-fmt")).toHaveAttribute(
      "data-suggest-label",
      "heading 2",
    );
    await ownerCards.getByRole("button", { name: "Accept" }).click();
    await expect(ownerEditor.locator("h2")).toContainText("Original");
    await expect(commenterEditor.locator("h2")).toContainText("Original");
    await expect(ownerEditor.locator(".suggest-block-fmt")).toHaveCount(0);
  } finally {
    await commenterContext.close();
  }
});
