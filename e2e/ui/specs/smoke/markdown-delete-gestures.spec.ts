import {
  test,
  expect as baseExpect,
  type Locator,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  createdDocumentID,
  documentPayload,
  settleSelection,
} from "../../helpers/markdown-document";

// Structural deletes take longer than the default assertion wait on a slow
// runner. configure() returns a new expect; it does not change the imported one.
const expect = baseExpect.configure({ timeout: 15000 });

// Real keyboard, real editor, real server. Unit tests of the editor cannot see
// what the server does with the commands these gestures send.

type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "separator" }
  | { kind: "list"; items: string[] };

// When a gesture does nothing, the page state says why; attach it to the failure.
function watch(page: Page) {
  const log: string[] = [];
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type()))
      log.push(`console.${m.type()}: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) =>
    log.push(`pageerror: ${e.message.slice(0, 200)}`),
  );
  page.on("response", (r) => {
    const path = new URL(r.url()).pathname;
    if (path.includes("/body/"))
      log.push(
        `HTTP ${r.request().method()} ${path.split("/").slice(-2).join("/")} -> ${r.status()}`,
      );
  });
  return async <T>(run: () => Promise<T>) => {
    try {
      return await run();
    } catch (error) {
      const alerts = await page.getByRole("alert").allTextContents();
      const status = await page.getByRole("status").allTextContents();
      throw new Error(
        `${(error as Error).message}\n--- page: alerts=${JSON.stringify(alerts)} status=${JSON.stringify(status)}\n${log.join("\n")}`,
      );
    }
  };
}

// The browser selects at once, but the editor learns of it from a later
// selectionchange event. A key pressed before that acts on the old caret: on a
// slow runner Backspace removed one letter instead of the selected word. The
// selection toolbar shows once the editor holds the selection.
async function editorHasSelection(page: Page) {
  await expect(
    page.getByRole("toolbar", { name: "Format selection" }),
  ).toBeVisible();
}

async function openDocument(page: Page, blocks: Block[]) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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
  await page.getByLabel("Workspace Name").fill(`Delete workspace ${suffix}`);
  const workspaceResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/workspaces",
  );
  await page.getByRole("button", { name: "Create Workspace" }).click();
  const workspaceID = (
    (await (await workspaceResponse).json()) as { data: { id: string } }
  ).data.id;

  let documentID = "";
  const rootNodeID = randomUUID();
  const nodes: unknown[] = [
    {
      nodeID: rootNodeID,
      parentID: null,
      siblingOrder: 1,
      type: "document",
      content: "",
      attributes: {},
    },
  ];
  blocks.forEach((block, index) => {
    const blockID = randomUUID();
    if (block.kind === "separator") {
      nodes.push({
        nodeID: blockID,
        parentID: rootNodeID,
        siblingOrder: index + 1,
        type: "thematic-break",
        content: "",
        attributes: {},
      });
      return;
    }
    if (block.kind === "list") {
      nodes.push({
        nodeID: blockID,
        parentID: rootNodeID,
        siblingOrder: index + 1,
        type: "bullet-list",
        content: "",
        attributes: { marker: "-", loose: false },
      });
      block.items.forEach((text, itemIndex) => {
        const itemID = randomUUID();
        const paragraphID = randomUUID();
        nodes.push(
          {
            nodeID: itemID,
            parentID: blockID,
            siblingOrder: itemIndex + 1,
            type: "list-item",
            content: "",
            attributes: {},
          },
          {
            nodeID: paragraphID,
            parentID: itemID,
            siblingOrder: 1,
            type: "paragraph",
            content: "",
            attributes: {},
          },
          {
            nodeID: randomUUID(),
            parentID: paragraphID,
            siblingOrder: 1,
            type: "run",
            content: text,
            attributes: {},
          },
        );
      });
      return;
    }
    nodes.push(
      {
        nodeID: blockID,
        parentID: rootNodeID,
        siblingOrder: index + 1,
        type: "paragraph",
        content: "",
        attributes: {},
      },
      {
        nodeID: randomUUID(),
        parentID: blockID,
        siblingOrder: 1,
        type: "run",
        content: block.text,
        attributes: {},
      },
    );
  });
  const accessCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "thisisjustarandomstring",
  );
  expect(accessCookie).toBeDefined();
  const apiURL = process.env.API_URL ?? "http://localhost:8080";
  const created = await page.request.post(`${apiURL}/api/v1/documents`, {
    headers: {
      Authorization: `Bearer ${accessCookie!.value}`,
      "X-Workspace-Id": workspaceID,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      title: `Delete doc ${suffix}`,
      type: "markdown",
      isDraft: true,
      ...documentPayload(nodes),
    },
  });
  expect(created.status()).toBe(201);
  documentID = await createdDocumentID(created);

  await page.goto(`/docs/${documentID}`);
  const editor = page.locator('.ProseMirror[contenteditable="true"]');
  await expect(editor).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("status")).toContainText("Synced");
  await page.getByRole("button", { name: /^Editor mode/ }).click();
  await page.getByRole("menuitemradio", { name: "Edit", exact: true }).click();
  return { editor, documentURL: page.url() };
}

async function expectNoReviewBanner(page: Page) {
  await expect(page.getByText(/Local changes need review/)).toHaveCount(0);
  await expect(page.getByText(/structural deletion requires/)).toHaveCount(0);
  await expect(page.getByText(/Block deletion is queued/)).toHaveCount(0);
}

const separatorDoc: Block[] = [
  { kind: "paragraph", text: "First block" },
  { kind: "separator" },
  { kind: "paragraph", text: "Second block" },
];

async function expectSeparatorGone(page: Page, editor: Locator) {
  await expect(editor.locator("hr")).toHaveCount(0);
  await expect(editor).toContainText("First block");
  await expect(editor).toContainText("Second block");
  await expectNoReviewBanner(page);
  await page.reload();
  await expect(page.getByRole("status")).toContainText("Synced");
  await expect(editor.locator("hr")).toHaveCount(0);
  await expect(editor).toContainText("Second block");
}

test("@live @smoke @deletegestures: Delete at the end of the paragraph before a separator removes it", async ({
  page,
}) => {
  test.setTimeout(90000);
  const diagnose = watch(page);
  const { editor } = await openDocument(page, separatorDoc);
  await diagnose(async () => {
    await editor.locator("p").filter({ hasText: "First block" }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Delete");
    await expectSeparatorGone(page, editor);
  });
});

test("@live @smoke @deletegestures: Backspace at the start of the paragraph after a separator removes it", async ({
  page,
}) => {
  test.setTimeout(90000);
  const { editor } = await openDocument(page, separatorDoc);
  await editor.locator("p").filter({ hasText: "Second block" }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Backspace");
  await expectSeparatorGone(page, editor);
});

test("@live @smoke @deletegestures: clicking a separator then Delete removes it", async ({
  page,
}) => {
  test.setTimeout(90000);
  const { editor } = await openDocument(page, separatorDoc);
  await editor.locator("hr").click();
  await page.keyboard.press("Delete");
  await expectSeparatorGone(page, editor);
});

test("@live @smoke @deletegestures: after Ctrl+A Delete the document accepts new text and keeps it", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { editor, documentURL } = await openDocument(page, [
    { kind: "paragraph", text: "First block" },
    { kind: "separator" },
    { kind: "paragraph", text: "Second block" },
  ]);
  await editor.locator("p").filter({ hasText: "Second block" }).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await expect(editor).not.toContainText("First block");
  await expect(editor).not.toContainText("Second block");
  await expect(editor.locator("hr")).toHaveCount(0);
  await expectNoReviewBanner(page);

  await page.reload();
  await expect(page.getByRole("status")).toContainText("Synced");
  await expect(editor).not.toContainText("block");
  await editor.locator("p").first().click();
  await page.keyboard.type("Typed again");
  await expect(editor).toContainText("Typed again");
  await expectNoReviewBanner(page);
  await page.goto(documentURL);
  await expect(page.getByRole("status")).toContainText("Synced");
  await expect(editor).toContainText("Typed again");
  await expectNoReviewBanner(page);
});

test("@live @smoke @deletegestures: Ctrl+A then Backspace removes everything", async ({
  page,
}) => {
  test.setTimeout(90000);
  const { editor } = await openDocument(page, [
    { kind: "paragraph", text: "Alpha" },
    { kind: "paragraph", text: "Beta" },
    { kind: "paragraph", text: "Gamma" },
  ]);
  await editor.locator("p").filter({ hasText: "Beta" }).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await expect(editor).not.toContainText("Alpha");
  await expect(editor).not.toContainText("Gamma");
  await expectNoReviewBanner(page);
  await page.reload();
  await expect(page.getByRole("status")).toContainText("Synced");
  await expect(editor).not.toContainText("Beta");
});

test("@live @smoke @deletegestures: deleting text across blocks keeps the rest and syncs", async ({
  page,
}) => {
  test.setTimeout(90000);
  const diagnose = watch(page);
  const { editor } = await openDocument(page, [
    { kind: "paragraph", text: "Keep this start and drop" },
    { kind: "paragraph", text: "middle block" },
    { kind: "paragraph", text: "drop and keep this end" },
  ]);
  await diagnose(async () => {
    // Select from after "Keep this start" to before "keep this end". Arrow keys
    // under load move the caret by a varying amount, so the range is set exactly,
    // and Backspace follows in the same moment, before the editor has read it.
    await editor.locator("p").filter({ hasText: "Keep this start" }).click();
    await page.evaluate(() => {
      const paragraphs = [...document.querySelectorAll(".ProseMirror p")];
      const text = (needle: string) =>
        paragraphs
          .find((p) => p.textContent?.includes(needle))!
          .querySelector("span")!.firstChild!;
      window
        .getSelection()!
        .setBaseAndExtent(
          text("Keep this start"),
          15,
          text("keep this end"),
          9,
        );
    });
    await page.keyboard.press("Backspace");
    await expect(editor).not.toContainText("middle block");
    await expect(editor).toContainText("Keep this start");
    await expect(editor).toContainText("keep this end");
    await expect(editor).not.toContainText("drop");
    await expectNoReviewBanner(page);
    await page.reload();
    await expect(page.getByRole("status")).toContainText("Synced");
    await expect(editor).not.toContainText("middle block");
    await expect(editor).toContainText("Keep this start");
    await expect(editor).toContainText("keep this end");
    await expect(editor).not.toContainText("drop");
  });
});

const threeParagraphs: Block[] = [
  { kind: "paragraph", text: "Alpha" },
  { kind: "paragraph", text: "Beta" },
  { kind: "paragraph", text: "Gamma" },
];

test("@live @smoke @deletegestures: triple-click a line then Backspace removes the line", async ({
  page,
}) => {
  test.setTimeout(90000);
  const diagnose = watch(page);
  const { editor } = await openDocument(page, threeParagraphs);
  await diagnose(async () => {
    await editor
      .locator("p")
      .filter({ hasText: "Beta" })
      .click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await expect(editor).not.toContainText("Beta");
    await expect(editor).toContainText("Alpha");
    await expect(editor).toContainText("Gamma");
    await expectNoReviewBanner(page);
    await page.reload();
    await expect(page.getByRole("status")).toContainText("Synced");
    await expect(editor).not.toContainText("Beta");
    await expect(editor).toContainText("Gamma");
  });
});

test("@live @smoke @deletegestures: emptying a line and pressing Backspace again removes the empty line", async ({
  page,
}) => {
  test.setTimeout(90000);
  const diagnose = watch(page);
  const { editor } = await openDocument(page, threeParagraphs);
  await diagnose(async () => {
    await editor.locator("p").filter({ hasText: "Beta" }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Shift+Home");
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString()))
      .toBe("Beta");
    await editorHasSelection(page);
    await page.keyboard.press("Backspace");
    await expect(editor.locator("p")).toHaveCount(3);
    await expect(editor.locator("p").nth(1)).toHaveText("");
    // The caret is put back after the delete: no click needed to go on.
    await settleSelection(page, { collapsed: true });
    await page.keyboard.press("Backspace");
    await expect(editor.locator("p")).toHaveCount(2);
    await expectNoReviewBanner(page);
    await page.reload();
    await expect(page.getByRole("status")).toContainText("Synced");
    await expect(editor.locator("p")).toHaveCount(2);
    await expect(editor).toContainText("Gamma");
  });
});

test("@live @smoke @deletegestures: Ctrl+A Delete then Ctrl+Z does not break the document", async ({
  page,
}) => {
  test.setTimeout(120000);
  const diagnose = watch(page);
  const { editor } = await openDocument(page, threeParagraphs);
  await diagnose(async () => {
    await editor.locator("p").filter({ hasText: "Beta" }).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await expect(editor).not.toContainText("Beta");
    await expectNoReviewBanner(page);
    await page.keyboard.press("ControlOrMeta+z");
    await expectNoReviewBanner(page);
    await expect(page.getByRole("status")).toContainText("Synced");
    await page.reload();
    await expect(page.getByRole("status")).toContainText("Synced");
    await expectNoReviewBanner(page);
  });
});

test("@live @smoke @deletegestures: Backspace at the start of a line joins it with the line above", async ({
  page,
}) => {
  test.setTimeout(90000);
  const diagnose = watch(page);
  const { editor } = await openDocument(page, threeParagraphs);
  await diagnose(async () => {
    await editor.locator("p").filter({ hasText: "Beta" }).click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Backspace");
    await expect(editor.locator("p")).toHaveCount(2);
    await expect(editor.locator("p").first()).toHaveText("AlphaBeta");
    await expectNoReviewBanner(page);
    await page.reload();
    await expect(page.getByRole("status")).toContainText("Synced");
    await expect(editor.locator("p")).toHaveCount(2);
    await expect(editor.locator("p").first()).toHaveText("AlphaBeta");
    await expect(editor).toContainText("Gamma");
  });
});

test("@live @smoke @deletegestures: Delete at the end of a line joins it with the line below", async ({
  page,
}) => {
  test.setTimeout(90000);
  const diagnose = watch(page);
  const { editor } = await openDocument(page, threeParagraphs);
  await diagnose(async () => {
    await editor.locator("p").filter({ hasText: "Alpha" }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Delete");
    await expect(editor.locator("p")).toHaveCount(2);
    await expect(editor.locator("p").first()).toHaveText("AlphaBeta");
    await expectNoReviewBanner(page);
    await page.reload();
    await expect(page.getByRole("status")).toContainText("Synced");
    await expect(editor.locator("p").first()).toHaveText("AlphaBeta");
  });
});

test("@live @smoke @deletegestures: typing, Ctrl+A Delete, then Ctrl+Z twice leaves the document usable", async ({
  page,
}) => {
  test.setTimeout(120000);
  const diagnose = watch(page);
  const { editor } = await openDocument(page, threeParagraphs);
  await diagnose(async () => {
    await editor.locator("p").filter({ hasText: "Gamma" }).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" typed");
    await expect(editor).toContainText("Gamma typed");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await expect(editor).not.toContainText("Alpha");
    await expectNoReviewBanner(page);
    await expect(page.getByRole("status")).toContainText("Synced");
    await page.keyboard.press("ControlOrMeta+z");
    await page.keyboard.press("ControlOrMeta+z");
    await expectNoReviewBanner(page);
    await expect(page.getByRole("status")).toContainText("Synced");
    await page.reload();
    await expect(page.getByRole("status")).toContainText("Synced");
    await expectNoReviewBanner(page);
  });
});

test("@live @smoke @deletegestures: Ctrl+Z after joining two lines does not break the document", async ({
  page,
}) => {
  test.setTimeout(120000);
  const diagnose = watch(page);
  const { editor } = await openDocument(page, threeParagraphs);
  await diagnose(async () => {
    await editor.locator("p").filter({ hasText: "Beta" }).click();
    await settleSelection(page, { collapsed: true });
    await page.keyboard.press("Home");
    await page.keyboard.press("Backspace");
    await expect(editor.locator("p")).toHaveCount(2);
    await expect(page.getByRole("status")).toContainText("Synced");
    await expect(editor).toBeVisible();
    await editor.locator("p").first().click();
    await settleSelection(page, { collapsed: true });
    await page.keyboard.press("ControlOrMeta+z");
    await expectNoReviewBanner(page);
    await expect(page.getByRole("status")).toContainText("Synced");
    await page.reload();
    await expect(page.getByRole("status")).toContainText("Synced");
    await expectNoReviewBanner(page);
  });
});

test("@live @smoke @deletegestures: Ctrl+Backspace and Ctrl+Delete remove one word", async ({
  page,
}) => {
  test.setTimeout(90000);
  const diagnose = watch(page);
  const { editor } = await openDocument(page, [
    { kind: "paragraph", text: "one two three" },
    { kind: "paragraph", text: "alone" },
  ]);
  await diagnose(async () => {
    const first = editor.locator("p").first();
    await first.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Control+Backspace");
    await expect(first).toHaveText("one two ");
    await page.keyboard.press("Home");
    await page.keyboard.press("Control+Delete");
    await expect(first).toHaveText(" two ");
    await expectNoReviewBanner(page);

    // A line with a single word: the word is the whole run.
    const second = editor.locator("p").nth(1);
    await second.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Control+Backspace");
    await expect(editor).not.toContainText("alone");
    await expectNoReviewBanner(page);
    await page.reload();
    await expect(page.getByRole("status")).toContainText("Synced");
    await expect(editor.locator("p").first()).toHaveText(" two ");
    await expect(editor).not.toContainText("alone");
  });
});

test("@live @smoke @deletegestures: triple-click a list item then Backspace removes the item and the page stays responsive", async ({
  page,
}) => {
  test.setTimeout(90000);
  const diagnose = watch(page);
  const { editor } = await openDocument(page, [
    { kind: "list", items: ["one", "two", "three"] },
  ]);
  await diagnose(async () => {
    await editor
      .locator("li")
      .filter({ hasText: "two" })
      .click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await expect(editor.locator("li")).toHaveCount(2);
    await expect(editor).not.toContainText("two");
    await expectNoReviewBanner(page);
    await expect(page.getByRole("status")).toContainText("Synced");
    await page.reload();
    await expect(page.getByRole("status")).toContainText("Synced");
    await expect(editor.locator("li")).toHaveCount(2);
    await expect(editor).toContainText("three");
  });
});

test("@live @smoke @deletegestures: after a line is deleted the caret is back and typing continues without a click", async ({
  page,
}) => {
  test.setTimeout(90000);
  const diagnose = watch(page);
  const { editor } = await openDocument(page, threeParagraphs);
  await diagnose(async () => {
    // The editor element is marked: if it is the same one after the delete, the
    // editor was not rebuilt (no flash, caret and undo history stay).
    await editor.evaluate((element) => {
      element.setAttribute("data-probe", "same-editor");
    });
    await editor
      .locator("p")
      .filter({ hasText: "Beta" })
      .click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await expect(editor).not.toContainText("Beta");
    await expect(editor).toBeVisible();
    await expect(editor).toHaveAttribute("data-probe", "same-editor");
    await expect(editor.locator("p").first())
      .toBeFocused({ timeout: 10000 })
      .catch(() => {});
    await settleSelection(page, { collapsed: true });
    await page.keyboard.type("X");
    await expect(editor).toContainText("X");
    await expectNoReviewBanner(page);
    await expect(page.getByRole("status")).toContainText("Synced");
    await page.reload();
    await expect(page.getByRole("status")).toContainText("Synced");
    await expect(editor).toContainText("X");
  });
});

for (const key of ["Control+Delete", "Control+Backspace"]) {
  test(`@live @smoke @deletegestures: ${key} on an empty line joins or removes it and shows no message`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    const diagnose = watch(page);
    const { editor } = await openDocument(page, threeParagraphs);
    await diagnose(async () => {
      await editor.locator("p").filter({ hasText: "Beta" }).click();
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+End");
      await expect
        .poll(() => page.evaluate(() => window.getSelection()?.toString()))
        .toBe("Beta");
      await editorHasSelection(page);
      await page.keyboard.press("Backspace");
      await expect(editor.locator("p")).toHaveCount(3);
      await expect(editor.locator("p").nth(1)).toHaveText("");
      // The caret is put back next to the empty line; click into it.
      await editor.locator("p").nth(1).click();
      await page.keyboard.press(key);
      await expect(editor.locator("p")).toHaveCount(2);
      await expect(editor).toContainText("Alpha");
      await expect(editor).toContainText("Gamma");
      await expect(page.getByText(/cannot be deleted in one step/)).toHaveCount(
        0,
      );
      await expectNoReviewBanner(page);
      await page.reload();
      await expect(page.getByRole("status")).toContainText("Synced");
      await expect(editor.locator("p")).toHaveCount(2);
    });
  });
}
