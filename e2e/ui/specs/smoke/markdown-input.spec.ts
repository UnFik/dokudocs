import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  expectNoInternalMessage,
  openMarkdownDocument,
  pastePlainText,
} from "../../helpers/markdown-document";

// Real keyboard, real clipboard event, real editor and server: the ways text
// becomes Markdown structure without a toolbar.

expect.configure({ timeout: 15000 });

const prd = readFileSync(
  new URL("../../fixtures/prd-nata.md", import.meta.url),
  "utf8",
);

test("@live @smoke @markdowninput: pasting a whole Markdown document keeps its structure and persists", async ({
  page,
}) => {
  test.setTimeout(90000);
  const { editor } = await openMarkdownDocument(page, ["start"]);
  await editor.locator("p").first().click();
  await page.keyboard.press("End");
  await pastePlainText(page, prd);

  await expect(editor.locator("h1")).toHaveCount(1);
  await expect(editor.locator("h2")).toHaveCount(4);
  await expect(editor.locator("h3")).toHaveCount(4);
  await expect(editor.locator("table")).toHaveCount(3);
  await expect(editor.locator("ol")).not.toHaveCount(0);
  await expect(editor.locator("ul")).not.toHaveCount(0);
  await expect(editor.locator("strong").first()).toBeVisible();
  await expectNoInternalMessage(page);

  await expect(page.getByRole("status")).toContainText("Synced");
  await page.reload();
  await expect(page.getByRole("status")).toContainText("Synced");
  await expect(editor.locator("h2")).toHaveCount(4);
  await expect(editor.locator("table")).toHaveCount(3);
  await expectNoInternalMessage(page);
});

test("@live @smoke @markdowninput: a paste the importer cannot read lands as plain lines instead of vanishing", async ({
  page,
}) => {
  test.setTimeout(60000);
  const { editor } = await openMarkdownDocument(page, ["start"]);
  await editor.locator("p").first().click();
  await page.keyboard.press("End");
  // A list item that ends in spaces before a blank line is what broke the strict import.
  await pastePlainText(page, "* first  \n* last  \n\n**after** the list\n");
  await expect(editor.locator("li")).toHaveCount(2);
  await expect(editor).toContainText("after the list");
  await expectNoInternalMessage(page);
});

test("@live @smoke @markdowninput: typing Markdown marks turns into formatting without its delimiters", async ({
  page,
}) => {
  test.setTimeout(90000);
  const { editor } = await openMarkdownDocument(page, ["start", ""]);
  await editor.locator("p").nth(1).click();
  await page.keyboard.type(
    "**bold** and *it* and `code` and ~~gone~~ and [docs](https://example.test/a) done",
  );

  await expect(editor.locator("strong")).toHaveText("bold");
  await expect(editor.locator("em")).toHaveText("it");
  await expect(editor.locator("code")).toHaveText("code");
  await expect(editor.locator("s")).toHaveText("gone");
  await expect(editor.locator("[data-link-href]")).toHaveText("docs");
  await expect(editor.locator("p").nth(1)).toHaveText(
    "bold and it and code and gone and docs done",
  );
  await expectNoInternalMessage(page);

  await expect(page.getByRole("status")).toContainText("Synced");
  await page.reload();
  await expect(page.getByRole("status")).toContainText("Synced");
  await expect(editor.locator("strong")).toHaveText("bold");
  await expect(editor.locator("[data-link-href]")).toHaveText("docs");
});

const blockCases: [string, string, string, string][] = [
  ["- one", "ul > li", "one", "a bulleted list"],
  ["1. one", "ol > li", "one", "a numbered list"],
  ["[ ] one", "ul > li", "one", "a task list"],
  ["> one", "blockquote", "one", "a quote"],
  ["```js ", "pre", "", "a code block"],
  ["# one", "h1", "one", "a heading"],
];

for (const [typed, selector, text, name] of blockCases) {
  test(`@live @smoke @markdowninput: typing "${typed}" at the start of a line makes ${name}, and what follows is not lost`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    const { editor } = await openMarkdownDocument(page, ["start", ""]);
    await editor.locator("p").nth(1).click();
    // Typed in one go: the keys after the marker arrive while the old line is
    // being replaced, and must not be dropped.
    await page.keyboard.type(typed);

    await expect(editor.locator(selector)).toHaveCount(1);
    if (text) await expect(editor.locator(selector)).toContainText(text);
    // The line the marker was typed on is gone.
    await expect(editor.locator(":scope > div > p")).toHaveCount(1);
    await expectNoInternalMessage(page);

    await expect(page.getByRole("status")).toContainText("Synced");
    await page.reload();
    await expect(page.getByRole("status")).toContainText("Synced");
    await expect(editor.locator(selector)).toHaveCount(1);
    if (text) await expect(editor.locator(selector)).toContainText(text);
    await expect(editor.locator(":scope > div > p")).toHaveCount(1);
  });
}

test("@live @smoke @markdowninput: typing --- makes a separator with a line after it", async ({
  page,
}) => {
  test.setTimeout(90000);
  const { editor } = await openMarkdownDocument(page, ["start", ""]);
  await editor.locator("p").nth(1).click();
  await page.keyboard.type("---");
  await expect(editor.locator("hr")).toHaveCount(1);
  await page.keyboard.type("after");
  await expect(editor.locator("p").last()).toHaveText("after");
  await expectNoInternalMessage(page);
  await expect(page.getByRole("status")).toContainText("Synced");
  await page.reload();
  await expect(page.getByRole("status")).toContainText("Synced");
  await expect(editor.locator("hr")).toHaveCount(1);
  await expect(editor.locator("p").last()).toHaveText("after");
});

test("@live @smoke @markdowninput: typing ':::tip ' makes a notice and '+++ ' makes a toggle", async ({
  page,
}) => {
  const { editor } = await openMarkdownDocument(page, ["", ""]);
  await editor.locator("p").first().click();
  await page.keyboard.type(":::tip ");
  await page.keyboard.type("Typed notice");
  await expect(editor.locator(".dd-notice-tip")).toContainText("Typed notice");

  await editor.locator("p").last().click();
  await page.keyboard.type("+++ ");
  await page.keyboard.type("Toggle title");
  await expect(editor.locator(".dd-toggle")).toContainText("Toggle title");
  await expect(editor.getByText(":::tip")).toHaveCount(0);
});

test("@live @smoke @markdowninput: an empty notice goes away with Backspace in it, or from its handle", async ({
  page,
}) => {
  const { editor } = await openMarkdownDocument(page, ["", "after"]);
  await editor.locator("p").first().click();
  await page.keyboard.type(":::tip ");
  await expect(editor.locator(".dd-notice-tip")).toHaveCount(1);
  await page.keyboard.press("Backspace");
  await expect(editor.locator(".dd-notice-tip")).toHaveCount(0);
  await expect(editor).toContainText("after");

  await editor.locator("p").first().click();
  await page.keyboard.press("Home");
  await page.keyboard.type(":::warning ");
  await expect(editor.locator(".dd-notice-warning")).toHaveCount(1);
  await page.locator(".dd-handle:not([hidden])").click();
  await page.keyboard.press("Backspace");
  await expect(editor.locator(".dd-notice-warning")).toHaveCount(0);
  await expect(editor).toContainText("after");
});

test("@live @smoke @markdowninput: a notice that held text and was emptied, or came from a paste, still goes with Backspace", async ({
  page,
}) => {
  const { editor } = await openMarkdownDocument(page, ["", "after"]);
  await editor.locator("p").first().click();
  await page.keyboard.type(":::tip ");
  await page.keyboard.type("temporary");
  for (let i = 0; i < "temporary".length; i++) await page.keyboard.press("Backspace");
  await expect(editor.locator(".dd-notice-tip")).toHaveCount(1);
  await page.keyboard.press("Backspace");
  await expect(editor.locator(".dd-notice-tip")).toHaveCount(0);

  await editor.locator("p").first().click();
  await page.keyboard.press("Home");
  await pastePlainText(page, ":::info\n\n:::\n\n+++\n\n+++");
  await expect(editor.locator(".dd-notice-info")).toHaveCount(1);
  await editor.locator(".dd-notice-info").click();
  await page.keyboard.press("Backspace");
  await expect(editor.locator(".dd-notice-info")).toHaveCount(0);
  await expect(editor).toContainText("after");
});

test("@live @smoke @markdowninput: Backspace at the end of a pasted heading takes one character, not the whole line", async ({
  page,
}) => {
  test.setTimeout(60000);
  const { editor } = await openMarkdownDocument(page, ["start"]);
  await editor.locator("p").first().click();
  await page.keyboard.press("End");
  await pastePlainText(page, "\n\n# Judul besar\n\nisi");
  const heading = editor.locator("h1");
  await heading.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Backspace");
  await expect(heading).toHaveText("Judul besa");
  await expectNoInternalMessage(page);
});

test("@live @smoke @markdowninput: table rows pasted one to a paragraph still become one table", async ({
  page,
}) => {
  test.setTimeout(60000);
  const { editor } = await openMarkdownDocument(page, ["start"]);
  await editor.locator("p").first().click();
  await page.keyboard.press("End");
  const rows = [
    "| Key | Value |",
    "| :---- | :---- |",
    "| Method | GET |",
    "| URL | …./member |",
  ];
  await pastePlainText(page, "\n\n" + rows.join("\n\n"));
  await expect(editor.locator("table")).toHaveCount(1);
  await expect(editor.locator("tr")).toHaveCount(3);
  await expectNoInternalMessage(page);
});
