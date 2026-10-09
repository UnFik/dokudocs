import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const apiURL = () => process.env.API_URL ?? "http://localhost:8080";

export type SourceDocument = {
  documentID: string;
  workspaceID: string;
  documentURL: string;
  /** Calls the API as the signed-in admin. */
  api: (path: string, init?: { method?: string; data?: unknown; headers?: Record<string, string> }) => ReturnType<APIRequestContext["fetch"]>;
};

/**
 * Signs in as the seeded admin, makes a workspace and a DBML or Mermaid
 * document holding `source`, and opens it.
 */
export async function openSourceDocument(
  page: Page,
  type: "dbdiagram" | "mermaid",
  source: string,
): Promise<SourceDocument> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await page.goto("/sign-in");
  await page.locator('input[name="email"]').fill("admin@example.com");
  await page.locator('input[name="password"]').fill("password123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname !== "/sign-in");
  await page.getByRole("button", { name: /workspace/i }).first().click();
  await page.getByRole("menuitem", { name: "Create Workspace" }).click();
  await page.getByLabel("Workspace Name").fill(`Diagram workspace ${suffix}`);
  const workspaceResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/workspaces",
  );
  await page.getByRole("button", { name: "Create Workspace" }).click();
  const workspaceID = (
    (await (await workspaceResponse).json()) as { data: { id: string } }
  ).data.id;

  const accessCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "thisisjustarandomstring",
  );
  expect(accessCookie).toBeDefined();
  const api: SourceDocument["api"] = (path, init = {}) =>
    page.request.fetch(`${apiURL()}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessCookie!.value}`,
        "X-Workspace-Id": workspaceID,
        ...init.headers,
      },
      data: init.data,
    });
  const created = await api("/api/v1/documents", {
    method: "POST",
    headers: { "Idempotency-Key": randomUUID() },
    data: { title: `Diagram ${suffix}`, type, isDraft: true, content: source },
  });
  expect(created.status()).toBe(201);
  const documentID = ((await created.json()) as { data: { id: string } }).data.id;

  await page.goto(`/docs/${documentID}`);
  await expect(page.getByText("Editing together")).toBeVisible({ timeout: 20000 });
  return { documentID, workspaceID, documentURL: page.url(), api };
}

/** The source the editor on this page shows. Monaco renders spaces as no-break spaces. */
export async function editorText(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".monaco-editor .view-line")]
      .map((line) => ({ top: parseFloat((line as HTMLElement).style.top), text: line.textContent ?? "" }))
      .sort((a, b) => a.top - b.top)
      .map((line) => line.text.replace(/ /g, " "))
      .join("\n"),
  );
}

/** Types at the end of the source, on a new line. */
export async function appendLine(page: Page, text: string) {
  await page.locator(".monaco-editor .view-lines").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(text);
}
