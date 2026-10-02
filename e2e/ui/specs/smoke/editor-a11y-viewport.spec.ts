import { test, expect, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const apiURL = process.env.API_URL ?? "http://localhost:8080";
const MIN_TARGET = 44;

type Rgb = [number, number, number];

function parseColor(value: string): Rgb | null {
  const rgb = value.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const srgb = value.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (srgb) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255];
  return null;
}

// WCAG 2.x relative luminance and ratio, same formula as antislop-human contrast-check.py.
function luminance([r, g, b]: Rgb) {
  const lin = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string) {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) throw new Error(`cannot parse colors: ${a} / ${b}`);
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

async function prepareDocument(page: Page) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await page.goto("/sign-in");
  await page.locator('input[name="email"]').fill("admin@example.com");
  await page.locator('input[name="password"]').fill("password123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname === "/");

  const token = (await page.context().cookies()).find(
    (cookie) => cookie.name === "thisisjustarandomstring",
  )!.value;
  const headers = { Authorization: `Bearer ${token}` };
  const workspace = await page.request.post(`${apiURL}/api/v1/workspaces`, {
    headers,
    data: { name: `A11y ${suffix}`, plan: "Pro Workspace" },
  });
  expect(workspace.status()).toBe(201);
  const workspaceID = ((await workspace.json()) as { data: { id: string } }).data.id;

  const documentID = randomUUID();
  const rootID = randomUUID();
  const node = (
    nodeID: string,
    parentID: string | null,
    siblingOrder: number,
    type: string,
    content = "",
  ) => ({ nodeID, parentID, siblingOrder, type, content, attributes: {} });
  const texts = ["Alpha block", "Bravo block", "Charlie block"];
  const blocks = texts.flatMap((text, index) => {
    const paragraphID = randomUUID();
    return [
      node(paragraphID, rootID, index + 1, "paragraph"),
      node(randomUUID(), paragraphID, 1, "run", text),
    ];
  });
  const created = await page.request.post(`${apiURL}/api/v1/documents`, {
    headers: {
      ...headers,
      "X-Workspace-Id": workspaceID,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      title: `A11y doc ${suffix}`,
      type: "markdown",
      isDraft: true,
      initialBody: {
        documentID,
        bodySchemaVersion: 1,
        rootNodeID: rootID,
        nodes: [
          node(rootID, null, 1, "document"),
          ...blocks,
          node(randomUUID(), rootID, 4, "paragraph"),
        ],
      },
    },
  });
  expect(created.status()).toBe(201);

  await page.goto(`/docs/${documentID}?workspaceId=${workspaceID}`);
  await expect(page.getByRole("status").first()).toContainText("Synced");
  await page.getByRole("tab", { name: "Edit", exact: true }).click();
  const editor = page.locator('.ProseMirror[contenteditable="true"]');
  await expect(editor).toBeVisible();
  return editor;
}

// Click into a block and wait until the editor owns the caret and ProseMirror has
// read it, so the next key press is not handled against the previous selection.
async function placeCaret(editor: Locator, block: Locator) {
  await block.click();
  await expect(editor).toBeFocused();
  await expect
    .poll(() => block.evaluate((el) => el.contains(getSelection()?.anchorNode ?? null)))
    .toBe(true);
  await editor.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
    offenders: [...document.querySelectorAll("*")]
      .filter((el) => {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return (
          box.width > 0 &&
          style.visibility !== "hidden" &&
          (box.right > document.documentElement.clientWidth + 0.5 || box.left < -0.5) &&
          !el.closest("[data-radix-popper-content-wrapper]")
        );
      })
      .slice(0, 5)
      .map((el) => `${el.tagName}.${(el.getAttribute("class") ?? "").slice(0, 60)}`),
  }));
  expect(overflow.scroll, `page scrolls horizontally: ${overflow.offenders.join(", ")}`).toBeLessThanOrEqual(overflow.client);
}

async function expectTargets(page: Page, selector: string, label: string) {
  const sizes = await page.locator(selector).evaluateAll((els) =>
    els
      .map((el) => {
        const box = el.getBoundingClientRect();
        return {
          name: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? el.tagName,
          width: Math.round(box.width * 10) / 10,
          height: Math.round(box.height * 10) / 10,
          shown: box.width > 0 && box.height > 0,
        };
      })
      .filter((item) => item.shown),
  );
  expect(sizes.length, `${label}: no visible targets found`).toBeGreaterThan(0);
  const small = sizes.filter((s) => s.width < MIN_TARGET || s.height < MIN_TARGET);
  expect(small, `${label}: targets under ${MIN_TARGET}px`).toEqual([]);
}

async function focusIndicator(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return null;
    const style = getComputedStyle(el);
    const outline =
      style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2;
    const ring = style.boxShadow !== "none" && style.boxShadow !== "";
    return {
      tag: el.tagName,
      label: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30),
      visible: outline || ring,
      outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
    };
  });
}

async function expectFocusVisible(page: Page) {
  const indicator = await focusIndicator(page);
  expect(indicator?.visible, `no visible focus indicator on ${JSON.stringify(indicator)}`).toBe(true);
}

const viewports = [
  { name: "phone 375px", width: 375, height: 800 },
  { name: "tablet 768px", width: 768, height: 1024 },
];

for (const viewport of viewports) {
  test.describe(`@live editor accessibility, ${viewport.name}, touch`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: true,
      isMobile: true,
    });

    test("toolbar, slash menu and block handle fit the screen and meet the 44px target", async ({ page }) => {
      test.setTimeout(90000);
      const editor = await prepareDocument(page);
      expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);

      await expectNoHorizontalOverflow(page);
      await expectTargets(page, ".dd-tb button", "insert and table toolbar");
      await expectTargets(page, '[role="group"][aria-label="History"] button', "undo and redo");

      // A tap is the only way to reveal the block handle on a touch screen.
      await editor.locator("p").filter({ hasText: "Bravo block" }).tap();
      await expect(page.locator(".dd-handle")).toBeVisible();
      await expectTargets(page, ".dd-handle:not([hidden])", "block handle");

      // Selection toolbar.
      await editor.press("Home");
      await editor.press("Shift+End");
      const selectionToolbar = page.getByRole("toolbar", { name: "Format selection" });
      await expect(selectionToolbar).toBeVisible();
      await expectTargets(page, '[role="toolbar"][aria-label="Format selection"] button', "selection toolbar");
      await page.keyboard.press("ControlOrMeta+k");
      await expect(page.getByLabel("Link address")).toBeVisible();
      await expectTargets(
        page,
        '[role="toolbar"][aria-label="Format selection"] form input, [role="toolbar"][aria-label="Format selection"] form button',
        "link form",
      );
      const bar = await selectionToolbar.boundingBox();
      expect(bar!.x).toBeGreaterThanOrEqual(0);
      expect(bar!.x + bar!.width).toBeLessThanOrEqual(viewport.width);
      await expectNoHorizontalOverflow(page);

      // Slash menu in the empty last paragraph.
      await placeCaret(editor, editor.locator("p").last());
      await page.keyboard.press("/");
      const combobox = page.getByRole("combobox", { name: "Insert block" });
      await expect(combobox).toBeVisible();
      await expectTargets(page, ".dd-slash-input, .dd-slash-option", "slash menu");
      const menu = await page.locator(".dd-slash").boundingBox();
      expect(menu!.x).toBeGreaterThanOrEqual(0);
      expect(menu!.x + menu!.width).toBeLessThanOrEqual(viewport.width);
      await expectNoHorizontalOverflow(page);
    });
  });
}

test.describe("@live editor accessibility, keyboard only, 768px", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("insert toolbar works with Tab, arrows, Enter and shows focus", async ({ page }) => {
    test.setTimeout(90000);
    const editor = await prepareDocument(page);
    await placeCaret(editor, editor.locator("p").filter({ hasText: "Alpha block" }));

    await page.keyboard.press("Shift+Tab");
    const toolbar = page.getByRole("toolbar", { name: "Insert and table tools" });
    await expect(toolbar.getByRole("button", { name: "Insert table" })).toBeFocused();
    await expectFocusVisible(page);

    await page.keyboard.press("ArrowRight");
    await expect(toolbar.getByRole("button", { name: "Add table row below" })).toBeFocused();
    await expectFocusVisible(page);
    await page.keyboard.press("End");
    await expect(toolbar.getByRole("button", { name: "Insert Mermaid diagram" })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(toolbar.getByRole("button", { name: "Insert table" })).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(editor.locator("table")).toHaveCount(1);
    await expect(editor).toBeFocused();
  });

  test("slash menu works with Arrow, Enter and Escape and shows focus", async ({ page }) => {
    test.setTimeout(90000);
    const editor = await prepareDocument(page);
    await placeCaret(editor, editor.locator("p").last());

    await page.keyboard.press("/");
    const combobox = page.getByRole("combobox", { name: "Insert block" });
    await expect(combobox).toBeFocused();
    await expectFocusVisible(page);
    await page.keyboard.press("Escape");
    await expect(combobox).toHaveCount(0);
    await expect(editor).toBeFocused();

    await page.keyboard.press("/");
    await expect(combobox).toBeFocused();
    await page.keyboard.type("list");
    await expect(page.getByRole("option")).toHaveCount(3);
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("option", { selected: true })).toHaveText(/Numbered list/);
    await page.keyboard.press("Enter");
    await expect(editor.locator("ol")).toHaveCount(1);
    await expect(combobox).toHaveCount(0);
  });

  test("block handle is reachable by Tab and moves a block with arrows", async ({ page }) => {
    test.setTimeout(90000);
    const editor = await prepareDocument(page);
    await placeCaret(editor, editor.locator("p").filter({ hasText: "Alpha block" }));

    // No mouse movement: the handle must still be there for the caret's block.
    const handle = page.getByRole("button", { name: /move block/i });
    await expect(handle).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(handle).toBeFocused();
    await expectFocusVisible(page);

    await page.keyboard.press("ArrowDown");
    await expect(editor.locator("p").nth(0)).toHaveText("Bravo block");
    await expect(editor.locator("p").nth(1)).toHaveText("Alpha block");
    // The handle follows the moved block, so a second press keeps moving it.
    await expect(handle).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(editor.locator("p").nth(2)).toHaveText("Alpha block");

    await page.keyboard.press("Escape");
    await expect(editor).toBeFocused();
  });

  test("selection toolbar is reachable from the selection with Tab and Enter", async ({ page }) => {
    test.setTimeout(90000);
    const editor = await prepareDocument(page);
    await placeCaret(editor, editor.locator("p").filter({ hasText: "Alpha block" }));
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    const toolbar = page.getByRole("toolbar", { name: "Format selection" });
    await expect(toolbar).toBeVisible();

    const bold = toolbar.getByRole("button", { name: "Bold" });
    for (let i = 0; i < 4 && !(await bold.evaluate((el) => el === document.activeElement)); i++)
      await page.keyboard.press("Tab");
    await expect(bold).toBeFocused();
    await expectFocusVisible(page);
    await page.keyboard.press("Enter");
    await expect(bold).toHaveAttribute("aria-pressed", "true");
    await expect(editor.locator("strong")).toHaveText("Alpha block");
  });
});

// Collaborator colors come from the backend palette (cursor.go).
const cursorPalette = [
  "#0369A1", "#B45309", "#15803D", "#B91C1C",
  "#7C3AED", "#0F766E", "#BE185D", "#4D7C0F",
];

for (const scheme of ["light", "dark"] as const) {
  test(`@live editor contrast in ${scheme} theme: toolbar and remote cursor label`, async ({ page }) => {
    test.setTimeout(90000);
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 768, height: 1024 });
    const editor = await prepareDocument(page);
    await expect(page.locator("html")).toHaveClass(new RegExp(scheme));

    // Insert toolbar buttons: label text on the bar.
    const toolbarPairs = await page.locator(".dd-tb button").evaluateAll((buttons) => {
      const bg = (el: Element) => {
        for (let node: Element | null = el; node; node = node.parentElement) {
          const c = getComputedStyle(node).backgroundColor;
          if (c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c;
        }
        return "rgb(255, 255, 255)";
      };
      return buttons.map((b) => ({
        name: b.getAttribute("aria-label")!,
        enabled: b.getAttribute("aria-disabled") !== "true",
        fg: getComputedStyle(b).color,
        bg: bg(b),
      }));
    });
    for (const pair of toolbarPairs.filter((p) => p.enabled))
      expect(contrast(pair.fg, pair.bg), `${scheme} toolbar "${pair.name}"`).toBeGreaterThanOrEqual(4.5);

    // Selection toolbar buttons (icons need 3:1, aria-labelled).
    await placeCaret(editor, editor.locator("p").filter({ hasText: "Alpha block" }));
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    const selection = page.getByRole("toolbar", { name: "Format selection" });
    await expect(selection).toBeVisible();
    const iconPairs = await selection.locator("button").evaluateAll((buttons) =>
      buttons.map((b) => ({
        name: b.getAttribute("aria-label")!,
        fg: getComputedStyle(b).color,
        bg: getComputedStyle(b.parentElement!.parentElement!).backgroundColor,
      })),
    );
    for (const pair of iconPairs)
      expect(contrast(pair.fg, pair.bg), `${scheme} selection "${pair.name}"`).toBeGreaterThanOrEqual(4.5);

    // Remote cursor label and caret, for every color the backend can assign.
    const results = await page.evaluate((palette) => {
      const body = document.querySelector(".markdown-body")!;
      const bg = (el: Element) => {
        for (let node: Element | null = el; node; node = node.parentElement) {
          const c = getComputedStyle(node).backgroundColor;
          if (c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c;
        }
        return "rgb(255, 255, 255)";
      };
      return palette.map((color) => {
        const caret = document.createElement("span");
        caret.className = "remote-cursor";
        caret.dataset.name = "Collaborator";
        caret.style.setProperty("--cursor-color", color);
        body.append(caret);
        const label = getComputedStyle(caret, "::after");
        const out = {
          color,
          labelText: label.color,
          labelBg: label.backgroundColor,
          caretEdge: getComputedStyle(caret).borderLeftColor,
          surface: bg(body),
        };
        caret.remove();
        return out;
      });
    }, cursorPalette);
    for (const r of results) {
      expect(contrast(r.labelText, r.labelBg), `${scheme} label text on ${r.color}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(r.caretEdge, r.surface), `${scheme} caret ${r.color} against the page`).toBeGreaterThanOrEqual(3);
    }
  });
}
