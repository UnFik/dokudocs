import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

// The tool bar at the bottom of the canvas: Comment pins, the Eraser, the lock,
// and a selection box over several elements.

const apiURL = () => process.env.API_URL ?? "http://localhost:8080";

test("@live @smoke: canvas tools, comment pins and selecting several elements", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/sign-in");
  await page.locator('input[name="email"]').fill("admin@example.com");
  await page.locator('input[name="password"]').fill("password123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname === "/dashboard");

  const token = (await page.context().cookies()).find((c) => c.name === "thisisjustarandomstring")!.value;
  const auth = { Authorization: `Bearer ${token}` };
  const workspaces = (await (await page.request.get(`${apiURL()}/api/v1/workspaces`, { headers: auth })).json()) as {
    data: { id: string }[] | null;
  };
  let workspaceID = workspaces.data?.[0]?.id;
  if (!workspaceID) {
    const made = await page.request.post(`${apiURL()}/api/v1/workspaces`, { headers: auth, data: { name: "Tools workspace" } });
    workspaceID = ((await made.json()) as { data: { id: string } }).data.id;
  }
  const host = randomUUID();
  const canvas = {
    version: 1,
    nodes: [
      { id: host, kind: "host", name: "VPS-1", catalog: "vps", x: 60, y: 60, w: 340, h: 210, parentId: null },
      { id: randomUUID(), kind: "system", name: "Backend", catalog: "golang", x: 14, y: 32, parentId: host },
      { id: randomUUID(), kind: "system", name: "Cache", catalog: "redis", x: 520, y: 80, parentId: null },
      { id: randomUUID(), kind: "system", name: "Queue", catalog: "kafka", x: 520, y: 220, parentId: null },
    ],
    connections: [],
  };
  const created = await page.request.post(`${apiURL()}/api/v1/documents`, {
    headers: { ...auth, "X-Workspace-Id": workspaceID, "Idempotency-Key": randomUUID() },
    data: { title: `Tools ${Date.now()}`, type: "architecture", isDraft: true, contentJSON: canvas },
  });
  expect(created.ok()).toBeTruthy();
  const documentID = ((await created.json()) as { data: { id: string } }).data.id;

  await page.goto(`/docs/${documentID}?workspaceId=${workspaceID}`);
  await expect(page.getByText("Editing together")).toBeVisible({ timeout: 20000 });
  const tools = page.getByRole("toolbar", { name: "Canvas tools" });
  await expect(tools).toBeVisible();
  await expect(tools.getByRole("button", { name: "Cursor" })).toHaveAttribute("aria-pressed", "true");
  const node = (name: string) => page.locator(".react-flow__node").filter({ hasText: name }).first();

  // The palette edge drags wider, and the width is kept for next time.
  // The width is remembered per person, so start (and end) at the default.
  const palette = page.getByRole("complementary", { name: "Palette" });
  const paletteEdge = page.getByRole("separator", { name: "Resize the palette" });
  await paletteEdge.dblclick();
  await expect(paletteEdge).toHaveAttribute("aria-valuenow", "216");
  const paletteWidth = (await palette.boundingBox())!.width;
  const edge = (await paletteEdge.boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + 200);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 + 80, edge.y + 200, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await palette.boundingBox())!.width)).toBe(Math.round(paletteWidth + 80));
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByText("Editing together")).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => Math.round((await palette.boundingBox())!.width)).toBe(Math.round(paletteWidth + 80));
  await paletteEdge.dblclick();
  await expect(paletteEdge).toHaveAttribute("aria-valuenow", "216");
  await page.waitForTimeout(800);

  // Comment: C, a click on Cache, then the new thread shows as a pin with a preview.
  await page.keyboard.press("c");
  await node("Cache").click({ position: { x: 30, y: 20 } });
  await page.getByRole("textbox", { name: "New comment on Cache" }).fill("Is this the session store?");
  await page.getByRole("dialog", { name: "New comment on Cache" }).getByRole("button", { name: "Comment", exact: true }).click();
  const pin = page.getByRole("button", { name: /^Comment by .* on Cache$/ });
  await expect(pin).toBeVisible();
  await expect(tools.getByRole("button", { name: "Cursor" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await pin.hover();
  await expect(page.getByRole("tooltip")).toContainText("Is this the session store?");

  // A selection box over Cache and Queue, then both move together.
  const cacheBox = (await node("Cache").boundingBox())!;
  const queueBox = (await node("Queue").boundingBox())!;
  await page.mouse.move(cacheBox.x - 20, cacheBox.y - 20);
  await page.mouse.down();
  await page.mouse.move(queueBox.x + queueBox.width + 20, queueBox.y + queueBox.height + 20, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator("#architecture-properties")).toContainText("2 elements selected");
  // Pressed in the middle of Cache, clear of its comment pin and its connection handle.
  const middle = { x: cacheBox.x + cacheBox.width / 2, y: cacheBox.y + cacheBox.height / 2 };
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down();
  await page.mouse.move(middle.x, middle.y + 100, { steps: 8 });
  await page.mouse.up();
  const after = (await node("Queue").boundingBox())!;
  expect(after.y - queueBox.y).toBeGreaterThan(60);

  // Eraser with the lock on stays active for a second element.
  await tools.getByRole("button", { name: "Lock tool" }).click();
  await page.keyboard.press("e");
  await node("Queue").click();
  await node("Cache").click();
  await expect(page.locator(".react-flow__node").filter({ hasText: "Queue" })).toHaveCount(0);
  await expect(page.locator(".react-flow__node").filter({ hasText: "Cache" })).toHaveCount(0);
  await expect(tools.getByRole("button", { name: "Eraser" })).toHaveAttribute("aria-pressed", "true");
  await tools.getByRole("button", { name: "Lock tool" }).click();

  // Hand pans and leaves the Host where it is.
  await page.keyboard.press("h");
  const before = (await node("VPS-1").boundingBox())!;
  await page.mouse.move(before.x + 60, before.y + 120);
  await page.mouse.down();
  await page.mouse.move(before.x + 160, before.y + 160, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press("v");
  await page.reload();
  await expect(page.getByText("Editing together")).toBeVisible({ timeout: 20000 });
  const saved = (await (await page.request.get(`${apiURL()}/api/v1/documents/${documentID}`, {
    headers: { ...auth, "X-Workspace-Id": workspaceID },
  })).json()) as { data: { contentJSON: { nodes: { name: string; x: number; y: number }[] } } };
  expect(saved.data.contentJSON.nodes.find((n) => n.name === "VPS-1")).toMatchObject({ x: 60, y: 60 });
});
