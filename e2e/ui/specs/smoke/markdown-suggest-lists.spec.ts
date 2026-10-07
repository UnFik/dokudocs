import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createdDocumentID, documentPayload, storedNodes } from "../../helpers/markdown-document";

test("@live @smoke @suggestlists: a commenter's Enter opens a list item or a quote paragraph the owner accepts or rejects", async ({
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
  const listID = randomUUID();
  const itemID = randomUUID();
  const itemParaID = randomUUID();
  const itemRunID = randomUUID();
  const quoteID = randomUUID();
  const quoteParaID = randomUUID();
  const tailParaID = randomUUID();
  const quoteRunID = randomUUID();
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
            nodeID: listID,
            parentID: rootNodeID,
            siblingOrder: 1,
            type: "bullet-list",
            content: "",
            attributes: { marker: "-", loose: false },
          },
          {
            nodeID: itemID,
            parentID: listID,
            siblingOrder: 1,
            type: "list-item",
            content: "",
            attributes: {},
          },
          {
            nodeID: itemParaID,
            parentID: itemID,
            siblingOrder: 1,
            type: "paragraph",
            content: "",
            attributes: {},
          },
          {
            nodeID: itemRunID,
            parentID: itemParaID,
            siblingOrder: 1,
            type: "run",
            content: "Apples",
            attributes: {},
          },
          {
            nodeID: quoteID,
            parentID: rootNodeID,
            siblingOrder: 2,
            type: "block-quote",
            content: "",
            attributes: {},
          },
          {
            nodeID: quoteParaID,
            parentID: quoteID,
            siblingOrder: 1,
            type: "paragraph",
            content: "",
            attributes: {},
          },
          {
            nodeID: quoteRunID,
            parentID: quoteParaID,
            siblingOrder: 1,
            type: "run",
            content: "Quoted",
            attributes: {},
          },
          {
            nodeID: randomUUID(),
            parentID: rootNodeID,
            siblingOrder: 3,
            type: "thematic-break",
            content: "",
            attributes: {},
          },
          {
            nodeID: tailParaID,
            parentID: rootNodeID,
            siblingOrder: 4,
            type: "paragraph",
            content: "",
            attributes: {},
          },
          {
            nodeID: randomUUID(),
            parentID: tailParaID,
            siblingOrder: 1,
            type: "run",
            content: "Tail",
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
    await commenter.waitForURL((url) => url.pathname === "/");
    await commenter.goto(`/docs/${documentID}`);
    const commenterEditor = commenter.locator(".ProseMirror");
    await expect(commenterEditor).toContainText("Apples");
    await commenter.getByRole("button", { name: /^Editor mode/ }).click();
  await commenter.getByRole("menuitemradio", { name: "Suggest", exact: true }).click();
    await expect(commenter.getByRole("status")).toContainText("Synced");

    await page.goto(`/docs/${documentID}`);
    const ownerEditor = page.locator(".ProseMirror");
    await expect(ownerEditor).toContainText("Apples");
    await expect(page.getByRole("status")).toContainText("Synced");
    await page.getByRole("button", { name: "Review", exact: true }).click();
    const ownerCards = page.getByRole("list", {
      name: "Suggestions and comments",
    });

    // Enter at the end of a list item opens the next item; typing fills it.
    await commenterEditor.getByText("Apples").click();
    await commenter.keyboard.press("End");
    await commenter.keyboard.press("Enter");
    await commenter.keyboard.type("Pears");
    await expect(ownerCards).toContainText('Add: “Pears”');
    await expect(ownerEditor.locator("li")).toHaveCount(2);
    await expect.poll(canonicalRuns).toEqual(["Apples", "Quoted", "Tail"]);
    await ownerCards.getByRole("button", { name: "Accept" }).click();
    await expect(ownerCards).toHaveCount(0);
    await expect(ownerEditor.locator("li")).toHaveCount(2);
    await expect(commenterEditor.locator("li")).toHaveCount(2);
    await expect
      .poll(canonicalRuns)
      .toEqual(["Apples", "Pears", "Quoted", "Tail"]);

    // Enter in the middle of an item splits it by copying the tail; the owner rejects.
    await commenterEditor.getByText("Pears").click();
    await commenter.keyboard.press("Home");
    await commenter.keyboard.press("ArrowRight");
    await commenter.keyboard.press("ArrowRight");
    await commenter.keyboard.press("Enter");
    await expect(ownerCards).toContainText("Split paragraph");
    await expect(ownerEditor.locator("li")).toHaveCount(3);
    await ownerCards.getByRole("button", { name: "Reject" }).click();
    await expect(ownerCards).toHaveCount(0);
    await expect(ownerEditor.locator("li")).toHaveCount(2);
    await expect
      .poll(canonicalRuns)
      .toEqual(["Apples", "Pears", "Quoted", "Tail"]);

    // Enter inside a quote adds a paragraph to the quote; the owner rejects it.
    await commenterEditor.getByText("Quoted").click();
    await commenter.keyboard.press("End");
    await commenter.keyboard.press("Enter");
    await commenter.keyboard.type("More");
    await expect(ownerCards).toContainText('Add: “More”');
    await expect(ownerEditor.locator("blockquote p")).toHaveCount(2);
    await ownerCards.getByRole("button", { name: "Reject" }).click();
    await expect(ownerCards).toHaveCount(0);
    await expect(ownerEditor.locator("blockquote p")).toHaveCount(1);
    await expect(commenterEditor.locator("blockquote p")).toHaveCount(1);
    await expect
      .poll(canonicalRuns)
      .toEqual(["Apples", "Pears", "Quoted", "Tail"]);

    // A block from the slash menu is a suggestion: a code block the owner accepts,
    // after the empty paragraph the commenter opened the menu in, which is rejected.
    await commenterEditor.getByText("Quoted").click();
    await commenter.keyboard.press("End");
    await commenter.keyboard.press("Enter");
    await commenter.keyboard.type("/");
    const menu = commenter.getByRole("combobox", { name: "Insert block" });
    await expect(menu).toBeFocused();
    await menu.fill("code");
    await menu.press("Enter");
    await expect(ownerCards).toContainText("Add: code block");
    await ownerCards
      .getByRole("listitem")
      .filter({ hasText: "Add: code block" })
      .getByRole("button", { name: "Accept" })
      .click();
    await expect(ownerEditor.locator("pre")).toHaveCount(1);
    await ownerCards.getByRole("button", { name: "Reject" }).click();
    await expect(ownerCards).toHaveCount(0);
    await expect(commenterEditor.locator("pre")).toHaveCount(1);
    await expect(ownerEditor.locator("blockquote p")).toHaveCount(1);

    // Backspace at the start of the line after a separator proposes deleting the
    // separator; the owner accepts and it is gone for both.
    await expect(ownerEditor.locator("hr")).toHaveCount(1);
    await commenterEditor.getByText("Tail").click();
    await commenter.keyboard.press("Home");
    await commenter.keyboard.press("Backspace");
    await expect(ownerCards).toContainText("Delete: divider");
    await expect(ownerEditor.locator("hr")).toHaveCount(1);
    await ownerCards.getByRole("button", { name: "Accept" }).click();
    await expect(ownerCards).toHaveCount(0);
    await expect(ownerEditor.locator("hr")).toHaveCount(0);
    await expect(commenterEditor.locator("hr")).toHaveCount(0);
    await expect
      .poll(canonicalRuns)
      .toEqual(["Apples", "Pears", "Quoted", "Tail"]);

    // A reload agrees.
    await page.reload();
    await expect(page.locator(".ProseMirror li")).toHaveCount(2);
    await expect(page.locator(".ProseMirror pre")).toHaveCount(1);
    await expect(page.locator(".ProseMirror .suggest-ins")).toHaveCount(0);
  } finally {
    await commenterContext.close();
  }
});
