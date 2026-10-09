import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

// An Architecture document end to end: build a canvas from the palette, connect
// two Systems, see it in a second browser, and find it again after a reload.

async function signInAndCreateCanvas(page: Page) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await page.goto("/sign-in");
  await page.locator('input[name="email"]').fill("admin@example.com");
  await page.locator('input[name="password"]').fill("password123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname === "/dashboard");
  await page.getByRole("button", { name: /workspace/i }).first().click();
  await page.getByRole("menuitem", { name: "Create Workspace" }).click();
  await page.getByLabel("Workspace Name").fill(`Canvas workspace ${suffix}`);
  const workspaceResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/workspaces",
  );
  await page.getByRole("button", { name: "Create Workspace" }).click();
  const workspaceID = ((await (await workspaceResponse).json()) as { data: { id: string } }).data.id;
  const token = (await page.context().cookies()).find((c) => c.name === "thisisjustarandomstring")!.value;
  const apiURL = process.env.API_URL ?? "http://localhost:8080";
  const created = await page.request.post(`${apiURL}/api/v1/documents`, {
    headers: { Authorization: `Bearer ${token}`, "X-Workspace-Id": workspaceID, "Idempotency-Key": randomUUID() },
    data: { title: `Prod ${suffix}`, type: "architecture", isDraft: true },
  });
  expect(created.status()).toBe(201);
  const documentID = ((await created.json()) as { data: { id: string } }).data.id;
  await page.goto(`/docs/${documentID}`);
  await expect(page.getByLabel("Architecture canvas")).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("Editing together")).toBeVisible({ timeout: 20000 });
  return { documentURL: page.url() };
}

async function dragFromPalette(page: Page, name: string, to: { x: number; y: number }) {
  const search = page.getByLabel("search the catalog");
  await search.fill(name);
  const item = page.getByRole("button", { name, exact: true }).first();
  const pane = page.locator(".react-flow__pane");
  await item.dragTo(pane, { targetPosition: to });
}

test("@live @smoke: an Architecture canvas is built from the palette and shared", async ({ page, browser }) => {
  test.setTimeout(120000);
  const { documentURL } = await signInAndCreateCanvas(page);

  await dragFromPalette(page, "VPS", { x: 300, y: 200 });
  const host = page.locator(".react-flow__node-host").first();
  await expect(host).toBeVisible();
  await expect(host).toContainText("VPS");

  // A System dropped on the Host lands in its first grid cell.
  const hostBox = (await host.boundingBox())!;
  const paneBox = (await page.locator(".react-flow__pane").boundingBox())!;
  await dragFromPalette(page, "Go", { x: hostBox.x - paneBox.x + 40, y: hostBox.y - paneBox.y + 50 });
  const goNode = page.locator(".react-flow__node-system").filter({ hasText: "Go" });
  await expect(goNode).toBeVisible();
  await expect(page.getByText("runs on")).toBeVisible();
  await expect(page.locator("#architecture-properties")).toContainText("VPS");

  await dragFromPalette(page, "PostgreSQL", { x: 700, y: 420 });
  const pgNode = page.locator(".react-flow__node-system").filter({ hasText: "PostgreSQL" });
  await expect(pgNode).toBeVisible();

  // Connect the Go service to PostgreSQL; the protocol suggestion follows the target.
  const source = goNode.locator(".react-flow__handle-right");
  const target = pgNode.locator(".react-flow__handle-left");
  await source.dragTo(target);
  const protocolDialog = page.getByRole("dialog", { name: "Choose the protocol" });
  await expect(protocolDialog).toBeVisible();
  await expect(protocolDialog.getByRole("button", { name: "db-connection" })).toBeVisible();
  await protocolDialog.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  // A comment on a System from the panel; its pin shows on the canvas.
  await pgNode.click();
  const properties = page.locator("#architecture-properties");
  await properties.getByLabel("New comment on PostgreSQL").fill("Which version runs here?");
  await properties.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(properties.getByText("Which version runs here?")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Comment by .* on PostgreSQL$/ })).toBeVisible();

  // A second browser sees the canvas, and it is still there after a reload.
  const storageState = await page.context().storageState();
  const second = await browser.newContext({ storageState });
  const secondPage = await second.newPage();
  await secondPage.goto(documentURL);
  await expect(secondPage.locator(".react-flow__node-system").filter({ hasText: "PostgreSQL" })).toBeVisible({ timeout: 20000 });
  await expect(secondPage.locator(".react-flow__edge")).toHaveCount(1);
  const secondPg = secondPage.locator(".react-flow__node-system").filter({ hasText: "PostgreSQL" });
  await expect(secondPage.getByRole("button", { name: /^Comment by .* on PostgreSQL$/ })).toBeVisible();
  await secondPg.click();
  await expect(secondPage.locator("#architecture-properties").getByText("Which version runs here?")).toBeVisible();
  await second.close();

  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.locator(".react-flow__node-system").filter({ hasText: "Go" })).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".react-flow__node-host")).toHaveCount(1);
});
