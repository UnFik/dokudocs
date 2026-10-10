import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createdDocumentID, documentPayload } from "../../helpers/markdown-document";

// A comment on words in a Markdown document names a member with @; the member is
// told in the sidebar and lands on the thread.

test("@live @smoke @comments: @ in a Markdown comment mentions a member, who opens the thread from the sidebar", async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  const suffix = randomUUID();
  const apiURL = process.env.API_URL ?? "http://localhost:8080";
  await page.goto("/sign-in");
  await page.locator('input[name="email"]').fill("admin@example.com");
  await page.locator('input[name="password"]').fill("password123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname === "/dashboard");
  await page.getByRole("button", { name: /workspace/i }).first().click();
  await page.getByRole("menuitem", { name: "Create Workspace" }).click();
  await page.getByLabel("Workspace Name").fill(`Markdown mentions ${suffix}`);
  const workspaceResponse = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/workspaces",
  );
  await page.getByRole("button", { name: "Create Workspace" }).click();
  const workspaceID = ((await (await workspaceResponse).json()) as { data: { id: string } }).data.id;
  const token = (await page.context().cookies()).find((c) => c.name === "thisisjustarandomstring")!.value;
  const owner = { Authorization: `Bearer ${token}`, "X-Workspace-Id": workspaceID };

  const memberEmail = `mention-md-${suffix}@example.invalid`;
  const registered = await page.request.post(`${apiURL}/api/v1/auth/register`, {
    data: { email: memberEmail, password: "password12345678", fullName: "Rina Pratama" },
  });
  expect(registered.status()).toBe(201);
  const memberID = ((await registered.json()) as { data: { user: { id: string } } }).data.user.id;
  const invite = await page.request.post(`${apiURL}/api/v1/workspaces/${workspaceID}/invites`, {
    headers: owner,
    data: { email: memberEmail, role: "member" },
  });
  expect(invite.status()).toBe(201);

  const root = randomUUID();
  const paragraph = randomUUID();
  const created = await page.request.post(`${apiURL}/api/v1/documents`, {
    headers: { ...owner, "Idempotency-Key": randomUUID() },
    data: {
      title: `Mention page ${suffix}`,
      type: "markdown",
      visibility: "workspace",
      isDraft: false,
      ...documentPayload([
        { nodeID: root, parentID: null, siblingOrder: 1, type: "document", content: "", attributes: {} },
        { nodeID: paragraph, parentID: root, siblingOrder: 1, type: "paragraph", content: "", attributes: {} },
        { nodeID: randomUUID(), parentID: paragraph, siblingOrder: 1, type: "run", content: "Original phrase", attributes: {} },
      ]),
    },
  });
  expect(created.status()).toBe(201);
  const documentID = await createdDocumentID(created);

  await page.goto(`/docs/${documentID}?workspaceId=${workspaceID}`);
  const editor = page.locator(".ProseMirror");
  await expect(editor).toContainText("Original phrase");
  await expect(page.getByRole("status")).toContainText("Synced");

  // Comment on the first word, naming the member.
  await expect(async () => {
    await editor.getByText("Original phrase").click();
    await page.keyboard.press("Home");
    for (let step = 0; step < "Original".length; step++) await page.keyboard.press("Shift+ArrowRight");
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("Original");
  }).toPass({ timeout: 15_000 });
  await page.keyboard.press("Control+Alt+m");
  const card = page.locator("li[data-new-comment]");
  const box = card.getByLabel("Comment", { exact: true });
  await box.click();
  await page.keyboard.type("hey @rin");
  const list = page.getByRole("listbox", { name: "People to mention" });
  await expect(list.getByRole("option", { name: /Rina Pratama/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(box).toHaveValue("hey @Rina Pratama ");
  await page.keyboard.type("is this title right?");
  await card.getByRole("button", { name: "Comment", exact: true }).click();

  const thread = page.locator("li[data-comment-thread-id]").first();
  await expect(thread.locator("[data-mention]")).toHaveText("@Rina Pratama");
  await expect(thread).not.toContainText("user:");
  const threadID = (await thread.getAttribute("data-comment-thread-id"))!;
  const stored = await page.request.get(`${apiURL}/api/v1/documents/${documentID}/comments`, { headers: owner });
  const content = ((await stored.json()) as { data: { id: string; content: string }[] }).data.find((c) => c.id === threadID)?.content;
  expect(content).toBe(`hey @[Rina Pratama](user:${memberID}) is this title right?`);

  // The member opens it from the sidebar and lands on the thread.
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await member.goto("/sign-in");
  await member.locator('input[name="email"]').fill(memberEmail);
  await member.locator('input[name="password"]').fill("password12345678");
  await member.getByRole("button", { name: /sign in/i }).click();
  await member.waitForURL((url) => url.pathname === "/dashboard");
  const inbox = member.getByRole("button", { name: /^Notifications/ });
  await expect(inbox).toContainText("1 new");
  await inbox.click();
  await member.getByRole("button", { name: /mentioned you in/ }).click();
  await member.waitForURL((url) => url.pathname === `/docs/${documentID}` && url.searchParams.get("thread") === threadID);
  await expect(member.locator(".ProseMirror")).toContainText("Original phrase", { timeout: 20000 });
  const memberThread = member.locator("li[data-comment-thread-id]").first();
  await expect(memberThread).toHaveAttribute("data-focused", "true", { timeout: 20000 });
  await expect(memberThread).toContainText("is this title right?");
  await expect(member.locator(".ProseMirror .comment-focus")).toHaveText("Original");
  await memberContext.close();
});
