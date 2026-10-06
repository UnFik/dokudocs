import { expect, test } from "@playwright/test";
import { openMarkdownDocument } from "../../helpers/markdown-document";

// Page features that follow Outline: the + button, the title as the first line
// with an info line, a Contents panel, heading labels and links, a click room
// below the text, Backspace undoing a Markdown rule, and smart text.
test("@live @smoke @pagefeatures: the + button opens the block menu on an empty line", async ({
  page,
}) => {
  const { editor } = await openMarkdownDocument(page, ["", "text"]);
  await editor.locator("p").first().click();
  const plus = page.getByRole("button", { name: "Add block" });
  await expect(plus).toBeVisible();
  await plus.click();
  await expect(page.getByRole("combobox", { name: "Insert block" })).toBeFocused();
  await page.getByRole("option", { name: /Heading 2/ }).click();
  await expect(editor.locator("h2")).toHaveCount(1);

  await editor.locator("p").filter({ hasText: "text" }).click();
  await expect(page.getByRole("button", { name: "Add block" })).toBeHidden();
});

test("@live @smoke @pagefeatures: the title is the first line, with an info line, and Arrow Up leads to it", async ({
  page,
}) => {
  const { editor } = await openMarkdownDocument(page, ["first line", "[ ] not a task"]);
  const title = page.getByRole("textbox", { name: "Document title" });
  await expect(title).toHaveValue(/Input doc/);
  const info = page.locator("p", { hasText: /^(Created|Updated) by / });
  await expect(info).toContainText(/ ago/);
  await expect(info.getByText("Draft", { exact: true })).toBeVisible();

  await title.press("Enter");
  await expect(editor).toBeFocused();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowUp");
  await expect(title).toBeFocused();

  await title.fill("Renamed from the page");
  await title.press("Tab");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Document title" })).toHaveValue(
    "Renamed from the page",
  );
});

test("@live @smoke @pagefeatures: Contents lists the headings and jumps to one", async ({
  page,
}) => {
  const { editor } = await openMarkdownDocument(page, ["", "body", ""]);
  await editor.locator("p").first().click();
  await page.keyboard.type("# ");
  await page.keyboard.type("Alpha title");
  await editor.locator("p").last().click();
  await page.keyboard.type("## ");
  await page.keyboard.type("Beta title");

  await page.getByRole("button", { name: "Contents" }).click();
  const nav = page.getByRole("navigation", { name: "Contents" });
  await expect(nav.getByRole("link", { name: "Alpha title" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Beta title" })).toBeVisible();

  await nav.getByRole("link", { name: "Beta title" }).click();
  await expect(nav.getByRole("link", { name: "Beta title" })).toHaveAttribute(
    "aria-current",
    "location",
  );
});

test("@live @smoke @pagefeatures: a heading shows its level and has a link button", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { editor } = await openMarkdownDocument(page, [""]);
  await editor.locator("p").first().click();
  await page.keyboard.type("### ");
  await page.keyboard.type("Third level");
  const heading = editor.locator("h3");
  await expect(heading).toHaveAttribute("data-heading-level", "H3");
  await heading.hover();
  await heading.getByRole("button", { name: "Copy link to heading" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/#node-[0-9a-f-]{36}$/);
});

test("@live @smoke @pagefeatures: Backspace right after a Markdown rule gives the typed text back", async ({
  page,
}) => {
  const { editor } = await openMarkdownDocument(page, [""]);
  await editor.locator("p").first().click();
  await page.keyboard.type("- ");
  await expect(editor.locator("ul")).toHaveCount(1);
  await page.keyboard.press("Backspace");
  await expect(editor.locator("ul")).toHaveCount(0);
  await expect(editor.locator("p").first()).toHaveText("- ");
});

test("@live @smoke @pagefeatures: clicking below a code block adds a line to type on", async ({
  page,
}) => {
  const { editor } = await openMarkdownDocument(page, [""]);
  await editor.locator("p").first().click();
  await page.keyboard.type("``` ");
  await expect(editor.locator("pre")).toHaveCount(1);
  await page.locator(".dd-page-end").click();
  await page.keyboard.type("after the code");
  await expect(editor.locator("p").last()).toHaveText("after the code");
});

test("@live @smoke @pagefeatures: smart text curls quotes only when turned on", async ({
  page,
}) => {
  const { editor } = await openMarkdownDocument(page, [""]);
  await editor.locator("p").first().click();
  await page.keyboard.type('"plain"');
  await expect(editor.locator("p").first()).toHaveText('"plain"');

  await page.getByRole("button", { name: "Smart text" }).click();
  await expect(page.getByRole("button", { name: "Smart text" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await editor.locator("p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(' "curly" ... ->');
  await expect(editor.locator("p").first()).toHaveText('"plain" “curly” … →');
});
