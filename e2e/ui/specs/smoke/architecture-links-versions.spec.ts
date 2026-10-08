import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

// A canvas as the entry to a project's documents: a spec page says which canvas
// uses it, a version freezes the canvas with that spec, and a System can be
// taken out of its Host.

async function signIn(page: Page) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await page.goto("/sign-in");
  await page.locator('input[name="email"]').fill("admin@example.com");
  await page.locator('input[name="password"]').fill("password123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname === "/dashboard");
  await page.getByRole("button", { name: /workspace/i }).first().click();
  await page.getByRole("menuitem", { name: "Create Workspace" }).click();
  await page.getByLabel("Workspace Name").fill(`Links workspace ${suffix}`);
  const workspaceResponse = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/workspaces",
  );
  await page.getByRole("button", { name: "Create Workspace" }).click();
  const workspaceID = ((await (await workspaceResponse).json()) as { data: { id: string } }).data.id;
  const token = (await page.context().cookies()).find((c) => c.name === "thisisjustarandomstring")!.value;
  const apiURL = process.env.API_URL ?? "http://localhost:8080";
  const create = async (data: Record<string, unknown>) => {
    const response = await page.request.post(`${apiURL}/api/v1/documents`, {
      headers: { Authorization: `Bearer ${token}`, "X-Workspace-Id": workspaceID, "Idempotency-Key": randomUUID() },
      data: { isDraft: true, ...data },
    });
    expect(response.status()).toBe(201);
    return ((await response.json()) as { data: { id: string } }).data.id;
  };
  return { create };
}

test("@live @smoke: Used in, versions with pinned documents, take out and fit", async ({ page }) => {
  test.setTimeout(120000);
  const { create } = await signIn(page);
  const specID = await create({ title: "Order API", type: "dbdiagram", content: "Table orders {\n  id int\n}" });
  const apiID = randomUUID();
  const canvasID = await create({
    title: "Prod",
    type: "architecture",
    contentJSON: {
      version: 1,
      nodes: [
        { id: "vps", kind: "host", name: "VPS-1", catalog: "vps", x: 100, y: 100, w: 400, h: 260, parentId: null },
        { id: apiID, kind: "system", name: "Backend Order", catalog: "golang", x: 14, y: 32, parentId: "vps", links: [specID] },
      ],
      connections: [],
    },
  });

  // Opening the canvas once stores it, which records the link.
  await page.goto(`/docs/${canvasID}`);
  await expect(page.getByText("Editing together")).toBeVisible({ timeout: 20000 });
  await page.locator(".react-flow__node-system").filter({ hasText: "Backend Order" }).click();
  await page.getByLabel("name").first().fill("Backend Order API");
  await page.waitForTimeout(1500);

  await page.goto(`/docs/${specID}`);
  const usedIn = page.getByRole("navigation", { name: "Used in architecture" });
  await expect(usedIn).toContainText("Prod › Backend Order API", { timeout: 20000 });
  await usedIn.getByRole("link").click();
  await expect(page.getByText("Editing together")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("#architecture-properties")).toContainText("Backend Order API");

  // A version freezes the canvas with the linked schema.
  await page.getByRole("button", { name: "Versions" }).click();
  await page.getByLabel("label", { exact: true }).fill("v1.0");
  await page.getByRole("button", { name: "Tag version" }).click();
  const versions = page.getByRole("dialog", { name: /Versions of Prod/ });
  await expect(versions.getByRole("heading", { name: "v1.0" })).toBeVisible();
  await expect(versions.getByText("frozen", { exact: true })).toBeVisible();
  await expect(versions.getByRole("img", { name: "Canvas at v1.0" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Take the System out of its Host, then fit the empty Host's neighbour.
  await page.locator(".react-flow__node-system").filter({ hasText: "Backend Order API" }).click();
  await page.getByRole("button", { name: /Take Backend Order API out of VPS-1/ }).click();
  await expect(page.locator("#architecture-properties")).toContainText("No Host");
  await page.locator(".react-flow__node-host").getByText("VPS-1").click();
  await expect(page.getByRole("button", { name: "Fit to contents" })).toBeDisabled();
  await expect(page.locator("#architecture-properties")).toContainText("Nothing inside to fit to.");
});
