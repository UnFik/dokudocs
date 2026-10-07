import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const node = (type: string, extra: object = {}, content?: unknown[]) => ({
  type,
  attrs: {
    nodeID: randomUUID(),
    bodyAttributes: JSON.stringify(extra),
    bodyContent: "",
  },
  ...(content ? { content } : {}),
});

type LegacyNode = {
  nodeID: string;
  parentID: string | null;
  siblingOrder: number;
  type: string;
  content: string;
  attributes: Record<string, unknown>;
};

const markOf: Record<string, string> = {
  bold: "strong",
  italic: "em",
  strike: "strike",
  code: "code",
};

/**
 * What `POST /documents` takes for a Markdown document, from a flat list of
 * nodes (id, parent, order, type, content, attributes): the editor's JSON and
 * its Markdown text.
 */
export function documentPayload(nodes: LegacyNode[]) {
  const children = new Map<string | null, LegacyNode[]>();
  for (const item of nodes) {
    const list = children.get(item.parentID) ?? [];
    list.push(item);
    children.set(item.parentID, list);
  }
  const build = (item: LegacyNode): Record<string, unknown> => {
    const type = item.type.replaceAll("-", "_").replaceAll(".", "_");
    const { href, linkTitle, ...rest } = item.attributes as Record<string, unknown>;
    const marks: Record<string, unknown>[] = [];
    for (const [flag, mark] of Object.entries(markOf))
      if (rest[flag]) marks.push({ type: mark });
    if (typeof href === "string")
      marks.push({ type: "link", attrs: { href, title: linkTitle ?? null } });
    const own = (children.get(item.nodeID) ?? [])
      .sort((a, b) => a.siblingOrder - b.siblingOrder)
      .map(build);
    const result: Record<string, unknown> = {
      type,
      attrs: {
        nodeID: item.nodeID,
        bodyAttributes: JSON.stringify(item.type === "run" ? {} : rest),
        bodyContent: ["thematic-break", "opaque", "opaque-inline"].includes(item.type)
          ? item.content
          : "",
      },
    };
    if (item.type === "run")
      result.content = item.content
        ? [{ type: "text", text: item.content, ...(marks.length ? { marks } : {}) }]
        : [];
    else if (own.length) result.content = own;
    else if (item.content && !["thematic-break", "opaque", "opaque-inline"].includes(item.type))
      result.content = [{ type: "text", text: item.content }];
    return result;
  };
  const root = nodes.find((item) => item.parentID === null)!;
  const text = (children.get(root.nodeID) ?? [])
    .sort((a, b) => a.siblingOrder - b.siblingOrder)
    .map((block) => {
      const runs = (children.get(block.nodeID) ?? []).map((run) => run.content).join("");
      return runs || block.content;
    })
    .join("\n\n");
  return { content: text, contentJSON: { type: "doc", content: [build(root)] } };
}

/** The id the server gave a document it just created. */
export async function createdDocumentID(response: {
  json(): Promise<unknown>;
}) {
  return ((await response.json()) as { data: { id: string } }).data.id;
}

/** The editor's document, as JSON, with one paragraph per entry. */
export function documentJSON(paragraphs: string[]) {
  return {
    type: "doc",
    content: [
      node(
        "document",
        {},
        paragraphs.map((text) =>
          node("paragraph", {}, text ? [node("run", {}, [{ type: "text", text }])] : []),
        ),
      ),
    ],
  };
}

/**
 * Signs in as the seeded admin, makes a workspace and a Markdown document with
 * one paragraph per entry of `paragraphs`, and opens it in Edit mode.
 */
export async function openMarkdownDocument(
  page: Page,
  paragraphs: string[] = ["start"],
) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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
  await page.getByLabel("Workspace Name").fill(`Input workspace ${suffix}`);
  const workspaceResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/workspaces",
  );
  await page.getByRole("button", { name: "Create Workspace" }).click();
  const workspaceID = (
    (await (await workspaceResponse).json()) as { data: { id: string } }
  ).data.id;

  const content = documentJSON(paragraphs);
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
      title: `Input doc ${suffix}`,
      type: "markdown",
      isDraft: true,
      content: paragraphs.join("\n\n"),
      contentJSON: content,
    },
  });
  expect(created.status()).toBe(201);
  const documentID = ((await created.json()) as { data: { id: string } }).data.id;

  await page.goto(`/docs/${documentID}`);
  const editor = page.locator('.ProseMirror[contenteditable="true"]');
  await expect(editor).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("status")).toContainText("Synced");
  await page.getByRole("button", { name: /^Editor mode/ }).click();
  await page.getByRole("menuitemradio", { name: "Edit", exact: true }).click();
  return { editor, documentURL: page.url(), workspaceID, documentID };
}

/** Pastes plain text into the editor as the browser would, at the caret. */
export async function pastePlainText(page: Page, text: string) {
  await page.evaluate((value) => {
    const element = document.querySelector(".ProseMirror")!;
    const data = new DataTransfer();
    data.setData("text/plain", value);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, text);
}

/** What the user must never see from an ordinary gesture. */
export async function expectNoInternalMessage(page: Page) {
  await expect(page.getByText(/Local changes need review/)).toHaveCount(0);
  await expect(page.getByText(/structural deletion requires/)).toHaveCount(0);
  await expect(page.getByText(/cannot be deleted in one step/)).toHaveCount(0);
  await expect(page.getByText(/cannot be imported/)).toHaveCount(0);
  await expect(page.getByText(/Block deletion is queued/)).toHaveCount(0);
}

export type StoredNode = LegacyNode;

const inverseMark: Record<string, string> = {
  strong: "bold",
  em: "italic",
  strike: "strike",
  code: "code",
};

const toBodyType = (name: string) =>
  name === "table_row"
    ? "table.row"
    : name === "table_cell"
      ? "table.cell"
      : name.replaceAll("_", "-");

/**
 * The document the server stored, as a flat list of nodes (id, parent, order,
 * type, content, attributes) read from its JSON. A text run keeps one entry
 * per run of equally marked text.
 */
export async function storedNodes(
  page: Page,
  documentID: string,
  headers: Record<string, string>,
): Promise<StoredNode[]> {
  const apiURL = process.env.API_URL ?? "http://localhost:8080";
  const response = await page.request.get(
    `${apiURL}/api/v1/documents/${documentID}`,
    { headers },
  );
  const json = ((await response.json()) as { data: { contentJSON?: unknown } })
    .data.contentJSON as { content?: JsonNode[] } | undefined;
  const nodes: StoredNode[] = [];
  const visit = (node: JsonNode, parentID: string | null, order: number) => {
    const attrs = (node.attrs ?? {}) as Record<string, unknown>;
    const nodeID = String(attrs.nodeID ?? "");
    const type = toBodyType(node.type);
    let attributes: Record<string, unknown> = {};
    try {
      attributes = JSON.parse(String(attrs.bodyAttributes ?? "{}"));
    } catch {
      // Attributes the editor wrote are always JSON; anything else reads as none.
    }
    // Text only proposed by a suggestion is not part of the stored document yet.
    const own = (node.content ?? []).filter(
      (child) =>
        !(child.marks ?? []).some((mark) => mark.type === "suggestion_insert"),
    );
    const textual = own.length > 0 && own.every((child) => child.type === "text");
    if (type === "run" || (textual && type !== "run")) {
      const content = own.map((child) => child.text ?? "").join("");
      const marks = (own[0]?.marks ?? []) as {
        type: string;
        attrs?: { href?: string; title?: string | null };
      }[];
      for (const mark of marks) {
        if (inverseMark[mark.type]) attributes[inverseMark[mark.type]!] = true;
        if (mark.type === "link" && mark.attrs?.href) {
          attributes.href = mark.attrs.href;
          if (mark.attrs.title) attributes.linkTitle = mark.attrs.title;
        }
      }
      nodes.push({ nodeID, parentID, siblingOrder: order, type, content, attributes });
      return;
    }
    const bodyContent = String(attrs.bodyContent ?? "");
    nodes.push({
      nodeID,
      parentID,
      siblingOrder: order,
      type,
      content: bodyContent,
      attributes,
    });
    own.forEach((child, index) => visit(child, nodeID, index + 1));
  };
  for (const root of json?.content ?? []) visit(root, null, 1);
  return nodes;
}

type JsonNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
  text?: string;
  marks?: { type: string }[];
};
