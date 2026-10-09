import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

// The canvas without a mouse, and for someone who may only comment.

const apiURL = () => process.env.API_URL ?? "http://localhost:8080";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname === "/dashboard");
}

test("@live @smoke: keyboard editing, undo, and a commenter's read-only canvas", async ({ page, browser }) => {
  test.setTimeout(120000);
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await signIn(page, "admin@example.com", "password123");
  await page.getByRole("button", { name: /workspace/i }).first().click();
  await page.getByRole("menuitem", { name: "Create Workspace" }).click();
  await page.getByLabel("Workspace Name").fill(`Keyboard workspace ${suffix}`);
  const workspaceResponse = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/workspaces",
  );
  await page.getByRole("button", { name: "Create Workspace" }).click();
  const workspaceID = ((await (await workspaceResponse).json()) as { data: { id: string } }).data.id;
  const token = (await page.context().cookies()).find((c) => c.name === "thisisjustarandomstring")!.value;
  const owner = { Authorization: `Bearer ${token}`, "X-Workspace-Id": workspaceID };
  const created = await page.request.post(`${apiURL()}/api/v1/documents`, {
    headers: { ...owner, "Idempotency-Key": randomUUID() },
    data: { title: "Staging", type: "architecture", isDraft: false, visibility: "private" },
  });
  const documentID = ((await created.json()) as { data: { id: string } }).data.id;

  await page.goto(`/docs/${documentID}`);
  await expect(page.getByText("Editing together")).toBeVisible({ timeout: 20000 });

  // Without a mouse: search, then Enter on the entry adds it to the view.
  await page.getByLabel("search the catalog").fill("Redis");
  await page.getByRole("button", { name: "Redis", exact: true }).first().focus();
  await page.keyboard.press("Enter");
  const redis = page.locator(".react-flow__node-system").filter({ hasText: "Redis" });
  await expect(redis).toBeVisible();

  // Delete takes it away with a notice; Ctrl+Z brings it back.
  await redis.click();
  await page.keyboard.press("Delete");
  await expect(redis).toHaveCount(0);
  await expect(page.getByText(/Redis deleted/)).toBeVisible();
  await page.locator(".react-flow__pane").click({ position: { x: 20, y: 20 } });
  await page.keyboard.press("Control+z");
  await expect(redis).toBeVisible();
  await page.waitForTimeout(1500);

  // A member with comment access sees the canvas read-only, and can comment.
  const memberEmail = `commenter-${suffix}@dokudocs.test`;
  const registered = await page.request.post(`${apiURL()}/api/v1/auth/register`, {
    data: { email: memberEmail, password: "password12345678", fullName: "Canvas Commenter" },
  });
  expect(registered.status()).toBe(201);
  expect((await page.request.post(`${apiURL()}/api/v1/workspaces/${workspaceID}/invites`, { headers: owner, data: { email: memberEmail, role: "member" } })).ok()).toBeTruthy();
  expect((await page.request.post(`${apiURL()}/api/v1/documents/${documentID}/accesses`, { headers: owner, data: { email: memberEmail, level: "comment" } })).status()).toBe(201);

  const other = await browser.newContext();
  const commenter = await other.newPage();
  await signIn(commenter, memberEmail, "password12345678");
  await commenter.goto(`/docs/${documentID}?workspaceId=${workspaceID}`);
  await expect(commenter.getByText("Viewing")).toBeVisible({ timeout: 20000 });
  await expect(commenter.getByText("You can view this canvas but not change it.")).toBeVisible();
  const theirRedis = commenter.locator(".react-flow__node-system").filter({ hasText: "Redis" });
  await theirRedis.click();
  await expect(commenter.getByLabel("name").first()).toBeDisabled();
  const theirProperties = commenter.locator("#architecture-properties");
  await theirProperties.getByLabel("New comment on Redis").fill("Is this the session store?");
  await theirProperties.getByRole("button", { name: "Comment", exact: true }).click();
  // The editor sees the new thread as a pin on Redis.
  await expect(page.getByRole("button", { name: /^Comment by .* on Redis$/ })).toBeVisible({ timeout: 20000 });
  // A commenter has Hand, Cursor and Comment, and no Eraser.
  const tools = commenter.getByRole("toolbar", { name: "Canvas tools" });
  await expect(tools.getByRole("button", { name: "Comment", exact: true })).toBeVisible();
  await expect(tools.getByRole("button", { name: "Eraser" })).toHaveCount(0);
  await other.close();
});
