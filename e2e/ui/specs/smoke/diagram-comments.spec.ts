import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { editorText, openSourceDocument } from "../../helpers/source-document";

// Comments on the words of a DBML or Mermaid source: written on a selection, shown
// on the words, followed as the source changes, mentioning a member who opens the
// thread from the sidebar.
for (const [type, source, word] of [
  ["dbdiagram", "Table users {\n  id int [pk]\n}", "Table"],
  ["mermaid", "graph TD\n  A --> B", "graph"],
] as const) {
  test(`@live @smoke @comments: ${type} comments sit on the words, follow the source and mention a member`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(150000);
    const apiURL = process.env.API_URL ?? "http://localhost:8080";
    const { documentID, workspaceID, api } = await openSourceDocument(page, type, source);

    // A draft is for people who may edit it, so publish it for someone who may only comment.
    expect((await api(`/api/v1/documents/${documentID}`, { method: "PUT", data: { isDraft: false } })).status()).toBe(200);

    // A member who may comment.
    const memberEmail = `diagram-${randomUUID()}@example.invalid`;
    const registered = await page.request.post(`${apiURL}/api/v1/auth/register`, {
      data: { email: memberEmail, password: "password12345678", fullName: "Dewi Lestari" },
    });
    expect(registered.status()).toBe(201);
    const memberID = ((await registered.json()) as { data: { user: { id: string } } }).data.user.id;
    expect((await api(`/api/v1/workspaces/${workspaceID}/invites`, { method: "POST", data: { email: memberEmail, role: "member" } })).status()).toBe(201);
    expect((await api(`/api/v1/documents/${documentID}/accesses`, { method: "POST", data: { email: memberEmail, level: "comment" } })).status()).toBe(201);

    // Select the first word and comment on it, naming the member.
    await page.locator(".monaco-editor .view-lines").click();
    await page.keyboard.press("ControlOrMeta+Home");
    for (let step = 0; step < word.length; step++) await page.keyboard.press("Shift+ArrowRight");
    await page.getByRole("button", { name: "Comments", exact: true }).click();
    const panel = page.getByRole("complementary", { name: "Comments" });
    await expect(panel.getByText(/No comments yet/)).toBeVisible();
    await panel.getByRole("button", { name: "Comment on selection" }).click();
    const card = panel.locator("li[data-new-comment]");
    await expect(card).toContainText(word);
    const box = card.getByLabel("Comment", { exact: true });
    await box.click();
    await page.keyboard.type("is this name right? @dew");
    await page.getByRole("option", { name: /Dewi Lestari/ }).click();
    await card.getByRole("button", { name: "Comment", exact: true }).click();

    const thread = panel.locator("li[data-comment-thread-id]").first();
    await expect(thread).toContainText("is this name right?");
    await expect(thread.locator("[data-mention]")).toHaveText("@Dewi Lestari");
    const mark = page.locator(".monaco-editor .source-comment-mark");
    await expect(mark.first()).toHaveText(word);
    const threadID = (await thread.getAttribute("data-comment-thread-id"))!;

    // The server holds a source anchor, and refuses one of another shape.
    const stored = ((await (await api(`/api/v1/documents/${documentID}/comments`)).json()) as {
      data: { id: string; content: string; anchor: { kind: string } }[];
    }).data.find((item) => item.id === threadID)!;
    expect(stored.anchor.kind).toBe("source");
    expect(stored.content).toContain(`(user:${memberID})`);
    const wrongShape = await api(`/api/v1/documents/${documentID}/comments`, {
      method: "POST",
      data: { threadID: randomUUID(), selectedText: "x", content: "no", anchor: { nodeID: "n", start: "AA==", end: "AQ==" } },
    });
    expect(wrongShape.status()).toBe(400);

    // The marks follow the words when text is added above them.
    await page.locator(".monaco-editor .view-lines").click();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.type("// above\n");
    await expect.poll(() => editorText(page)).toContain("// above");
    await expect(mark.first()).toHaveText(word);

    // The member sees the thread and the words without reloading, and opens it from the sidebar.
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
    const memberPanel = member.getByRole("complementary", { name: "Comments" });
    await expect(memberPanel).toContainText("is this name right?", { timeout: 20000 });
    await expect(memberPanel.locator("li[data-comment-thread-id]").first()).toHaveAttribute("data-focused", "true");
    await expect(member.locator(".monaco-editor .source-comment-focus").first()).toHaveText(word);

    // Resolving removes the marks for everyone.
    await thread.getByRole("button", { name: "Resolve comment" }).click();
    await expect(mark).toHaveCount(0);
    await expect(member.locator(".monaco-editor .source-comment-focus")).toHaveCount(0, { timeout: 20000 });
    await memberContext.close();

    // Deleting the words the comment was about leaves it, marked as changed.
    await page.getByRole("button", { name: /Show 1 resolved comment/ }).click();
    await thread.getByRole("button", { name: "Reopen comment" }).click();
    await expect(mark.first()).toHaveText(word);
    await page.locator(".monaco-editor .view-lines").click();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Home");
    for (let step = 0; step < word.length; step++) await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Delete");
    await expect(mark).toHaveCount(0);
    await expect(thread).toContainText("text changed");
  });
}
