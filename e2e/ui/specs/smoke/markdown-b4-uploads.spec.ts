import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { documentJSON, openMarkdownDocument, pastePlainText } from "../../helpers/markdown-document";

// A 1x1 PNG.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function chooseFile(
  page: import("@playwright/test").Page,
  file: { name: string; mimeType: string; buffer: Buffer },
) {
  await page.keyboard.press("/");
  await page.getByRole("combobox", { name: "Insert block" }).fill("image");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("option", { name: /Image or file/ }).click();
  await (await chooser).setFiles(file);
}

test("@live @smoke @uploads: an image and a file from the block menu show in place and survive a reload", async ({
  page,
}) => {
  const { editor } = await openMarkdownDocument(page, ["", ""]);
  await editor.locator("p").first().click();
  await chooseFile(page, { name: "dot.png", mimeType: "image/png", buffer: png });
  const image = editor.locator(".dd-image img");
  await expect(image).toHaveCount(1);
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBe(1);

  await editor.locator("p").last().click();
  await chooseFile(page, {
    name: "notes.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("PK\x03\x04"),
  });
  await expect(editor.locator(".dd-attachment-card")).toContainText("notes.zip");

  await expect(page.getByRole("status")).toContainText("Synced");
  await page.reload();
  await expect(page.locator(".ProseMirror .dd-image img")).toHaveCount(1);
  await expect
    .poll(() =>
      page.locator(".ProseMirror .dd-image img").evaluate((el: HTMLImageElement) => el.naturalWidth),
    )
    .toBe(1);
  await expect(page.locator(".ProseMirror .dd-attachment-card")).toContainText("notes.zip");
});

test("@live @smoke @embeds: a known address pasted into an empty line becomes a framed embed", async ({
  page,
}) => {
  const { editor } = await openMarkdownDocument(page, ["", ""]);
  await editor.locator("p").first().click();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "https://youtu.be/dQw4w9WgXcQ");
    document
      .querySelector(".ProseMirror")!
      .dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  const frame = editor.locator(".dd-embed iframe");
  await expect(frame).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  await expect(page.getByRole("status")).toContainText("Synced");
  await page.reload();
  await expect(page.locator(".ProseMirror .dd-embed iframe")).toHaveCount(1);
});

test("@live @smoke @backlinks: a page that links here is listed under Referenced by", async ({
  page,
}) => {
  const { documentURL } = await openMarkdownDocument(page, ["target"]);
  const targetID = new URL(documentURL).pathname.split("/").pop()!;
  const token = (await page.context().cookies()).find(
    (cookie) => cookie.name === "thisisjustarandomstring",
  )!.value;
  const apiURL = process.env.API_URL ?? "http://localhost:8080";
  const headers = { Authorization: `Bearer ${token}` };
  const target = await page.request.get(`${apiURL}/api/v1/documents/${targetID}`, {
    headers: { ...headers, "X-Workspace-Id": await workspaceOf(page, apiURL, headers, targetID) },
  });
  expect(target.ok()).toBe(true);
  const workspaceID = ((await target.json()) as { data: { workspaceId: string } }).data.workspaceId;
  const created = await page.request.post(`${apiURL}/api/v1/documents`, {
    headers: { ...headers, "X-Workspace-Id": workspaceID, "Idempotency-Key": randomUUID() },
    data: {
      title: "Points at target",
      type: "markdown",
      isDraft: false,
      content: `see /docs/${targetID}`,
      contentJSON: documentJSON([`see /docs/${targetID}`]),
    },
  });
  expect(created.status()).toBe(201);

  await page.reload();
  await page.getByRole("button", { name: "Contents" }).click();
  await expect(
    page.getByRole("navigation", { name: "Contents" }).getByRole("link", { name: "Points at target" }),
  ).toBeVisible();
});

async function workspaceOf(
  page: import("@playwright/test").Page,
  apiURL: string,
  headers: Record<string, string>,
  _documentID: string,
) {
  const workspaces = await page.request.get(`${apiURL}/api/v1/workspaces`, { headers });
  const list = ((await workspaces.json()) as { data: { id: string }[] }).data;
  return list[list.length - 1]!.id;
}

test("@live @smoke @presentation: Ctrl+Alt+P shows the page as slides and Ctrl+Shift+I shows insights", async ({
  page,
}) => {
  const { editor } = await openMarkdownDocument(page, ["", ""]);
  await editor.locator("p").first().click();
  await page.keyboard.type("# Opening");
  await editor.locator("p").last().click();
  await page.keyboard.type("## Closing");
  await expect(page.getByRole("status")).toContainText("Synced");

  await page.keyboard.press("Control+Alt+p");
  const slides = page.getByRole("dialog", { name: "Presentation" });
  await expect(slides).toContainText("Opening");
  await expect(slides).toContainText("1 / 2");
  await page.keyboard.press("ArrowRight");
  await expect(slides).toContainText("Closing");
  await page.keyboard.press("Escape");
  await expect(slides).toBeHidden();

  await page.keyboard.press("Control+Shift+i");
  await expect(page.getByRole("dialog", { name: "Insights" })).toContainText("Views");
});

test("@live @smoke @split: the Markdown button shows the exported text beside the editor and follows edits", async ({
  page,
}) => {
  const { editor } = await openMarkdownDocument(page, ["first"]);
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  const source = page.getByRole("complementary", { name: "Markdown source" });
  await expect(source).toContainText("first");
  await editor.locator("p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" and more");
  await expect(source).toContainText("first and more");
});

test("@live @smoke @revisions: the version list steps through the changes from the version before", async ({
  page,
}) => {
  const { editor } = await openMarkdownDocument(page, ["alpha"]);
  await editor.locator("p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" beta");
  await expect(page.getByRole("status")).toContainText("Synced");
  await page.getByTitle("Version History").click();
  await page.getByTitle("Create Named Milestone").click();
  await page.getByPlaceholder(/Pre-release/).fill("after beta");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  // The list refetches after saving; give it room when the machine is busy.
  await expect(page.getByText(/Change 1 of/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Next change" })).toBeVisible();
});

test("@live @smoke @comments: selecting text offers an Add comment icon that opens a comment on it", async ({
  page,
}) => {
  const { editor } = await openMarkdownDocument(page, ["comment on these words"]);
  await editor.locator("p").first().click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.getByRole("toolbar", { name: "Format selection" }).getByRole("button", { name: "Add comment" }).click();
  const draft = page.locator("li[data-new-comment]");
  await expect(draft).toContainText("comment on these words");
  await draft.getByLabel("Comment", { exact: true }).fill("Why these words?");
  await draft.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page.getByRole("list", { name: "Suggestions and comments" })).toContainText("Why these words?");
  // The Review panel no longer carries its own Comment button.
  await expect(page.getByRole("complementary", { name: "Review" }).getByRole("button", { name: "Comment", exact: true })).toHaveCount(0);
});

test("@live @smoke @blockdelete: a block chosen with its handle is deleted with Backspace, and a file block by clicking it", async ({
  page,
}) => {
  const { editor } = await openMarkdownDocument(page, ["keep one", "remove me", "keep two"]);
  await editor.locator("p").filter({ hasText: "remove me" }).click();
  const handle = page.locator(".dd-handle:not([hidden])");
  await handle.click();
  await expect(editor.locator(".dd-block-selected")).toHaveText("remove me");
  await page.keyboard.press("Backspace");
  await expect(editor).not.toContainText("remove me");
  await expect(editor.locator("p")).toHaveCount(2);

  // A file block is chosen by clicking it.
  await editor.locator("p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await chooseFile(page, { name: "gone.zip", mimeType: "application/zip", buffer: Buffer.from("PK\x03\x04") });
  const card = editor.locator(".dd-attachment-card");
  await expect(card).toContainText("gone.zip");
  await card.locator("span").click();
  await page.keyboard.press("Backspace");
  await expect(editor.locator(".dd-attachment-card")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Synced");
  await page.reload();
  await expect(page.locator(".ProseMirror")).not.toContainText("remove me");
  await expect(page.locator(".ProseMirror .dd-attachment-card")).toHaveCount(0);
});

test("@live @smoke @markdownpaste: Markdown pasted as text, or chosen as a .md file, becomes headings, lists and bold", async ({
  page,
}) => {
  const { editor } = await openMarkdownDocument(page, ["", ""]);
  await editor.locator("p").first().click();
  await pastePlainText(page, "# Pasted title\n\n- one\n- two\n\nSome **bold** words");
  await expect(editor.locator("h1")).toHaveText("Pasted title");
  await expect(editor.locator("ul li")).toHaveCount(2);
  await expect(editor.locator("strong")).toHaveText("bold");

  await editor.locator("p").last().click();
  await chooseFile(page, {
    name: "notes.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("## From a file\n\n1. first\n2. second\n"),
  });
  await expect(editor.locator("h2")).toHaveText("From a file");
  await expect(editor.locator("ol li")).toHaveCount(2);
  await expect(editor.locator(".dd-attachment-card")).toHaveCount(0);
});

test("@live @smoke @split: pasted :::/+++ blocks become real blocks and show as markers in the Markdown pane", async ({
  page,
}) => {
  const { editor } = await openMarkdownDocument(page, ["", ""]);
  await editor.locator("p").first().click();
  await pastePlainText(page, ":::tip\nRemember this\n:::\n\n+++\nTitle line\nHidden body\n+++");
  await expect(editor.locator(".dd-notice-tip")).toContainText("Remember this");
  await expect(editor.locator(".dd-toggle")).toContainText("Hidden body");

  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  const source = page.getByRole("complementary", { name: "Markdown source" });
  await expect(source).toContainText(":::tip");
  await expect(source).toContainText("+++");
});
