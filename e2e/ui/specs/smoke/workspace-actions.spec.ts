import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

// Drafts, rename, trash and project delete act on the server, not on a local
// copy: each change shows up again after a reload.

const apiURL = () => process.env.API_URL ?? "http://localhost:8080";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.locator('input[name="email"]').fill("admin@example.com");
  await page.locator('input[name="password"]').fill("password123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname === "/dashboard");
  const token = (await page.context().cookies()).find(
    (c) => c.name === "thisisjustarandomstring",
  )!.value;
  const auth = { Authorization: `Bearer ${token}` };
  const workspaces = (await (
    await page.request.get(`${apiURL()}/api/v1/workspaces`, { headers: auth })
  ).json()) as { data: { id: string }[] | null };
  let workspaceID = workspaces.data?.[0]?.id;
  if (!workspaceID) {
    const made = await page.request.post(`${apiURL()}/api/v1/workspaces`, {
      headers: auth,
      data: { name: "Actions workspace" },
    });
    workspaceID = ((await made.json()) as { data: { id: string } }).data.id;
  }
  return { auth: { ...auth, "X-Workspace-Id": workspaceID } };
}

async function createDocument(
  page: Page,
  headers: Record<string, string>,
  data: Record<string, unknown>,
) {
  const res = await page.request.post(`${apiURL()}/api/v1/documents`, {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: { type: "markdown", content: "# Hello", ...data },
  });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { data: { id: string } }).data.id;
}

const card = (page: Page, title: string) =>
  page.locator("div.group.cursor-pointer").filter({ hasText: title });

test("@live @smoke: starring a draft from the Drafts page", async ({ page }) => {
  test.setTimeout(90000);
  const { auth } = await signIn(page);
  const title = `Draft star ${Date.now()}`;
  await createDocument(page, auth, { title, isDraft: true });

  await page.goto("/drafts");
  await card(page, title)
    .getByRole("button", { name: "Star Document" })
    .click();
  await expect(
    card(page, title).getByRole("button", { name: "Unstar Document" }),
  ).toBeVisible();

  await page.reload();
  await expect(
    card(page, title).getByRole("button", { name: "Unstar Document" }),
  ).toBeVisible({ timeout: 20000 });
});

test("@live @smoke: rename, trash and restore a document", async ({ page }) => {
  test.setTimeout(120000);
  const { auth } = await signIn(page);
  const title = `Trash me ${Date.now()}`;
  await createDocument(page, auth, { title, isDraft: true });

  await page.goto("/drafts");
  await card(page, title).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const renamed = `${title} renamed`;
  await page.getByLabel("Document Title").fill(renamed);
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(card(page, renamed)).toBeVisible();
  await page.reload();
  await expect(card(page, renamed)).toBeVisible({ timeout: 20000 });

  await card(page, renamed).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to Trash" }).click();
  await expect(card(page, renamed)).toHaveCount(0);

  await page.goto("/trash");
  const row = page.getByRole("row").filter({ hasText: renamed });
  await expect(row).toBeVisible({ timeout: 20000 });
  await row.getByTitle("Restore Document").click();
  await expect(row).toHaveCount(0);

  await page.goto("/drafts");
  await expect(card(page, renamed)).toBeVisible({ timeout: 20000 });
});

test("@live @smoke: deleting a project keeps its documents as drafts", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { auth } = await signIn(page);
  const stamp = Date.now();
  const projectName = `Doomed ${stamp}`;
  const created = await page.request.post(`${apiURL()}/api/v1/projects`, {
    headers: auth,
    data: { name: projectName, categories: ["General"] },
  });
  expect(created.ok()).toBeTruthy();
  const projectID = ((await created.json()) as { data: { id: string } }).data
    .id;
  const title = `Survivor ${stamp}`;
  await createDocument(page, auth, { title, projectId: projectID, isDraft: false });

  await page.goto("/projects");
  const projectCard = page
    .locator("div.group.cursor-pointer")
    .filter({ hasText: projectName });
  await expect(projectCard).toBeVisible({ timeout: 20000 });
  await projectCard.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete Project" }).click();
  await page.getByLabel(/Type .* to confirm/).fill(projectName);
  await page.getByRole("button", { name: "Delete Project", exact: true }).click();
  await expect(projectCard).toHaveCount(0);

  await page.reload();
  await expect(projectCard).toHaveCount(0);

  await page.goto("/drafts");
  await expect(card(page, title)).toBeVisible({ timeout: 20000 });
});
