import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

// A star on a document card is the server's star: the card shows it, the
// sidebar lists it, and both survive a reload.

const apiURL = () => process.env.API_URL ?? "http://localhost:8080";

test("@live @smoke: starring a document from its card", async ({ page }) => {
  test.setTimeout(90000);
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
  ).json()) as {
    data: { id: string }[] | null;
  };
  let workspaceID = workspaces.data?.[0]?.id;
  if (!workspaceID) {
    const made = await page.request.post(`${apiURL()}/api/v1/workspaces`, {
      headers: auth,
      data: { name: "Star workspace" },
    });
    workspaceID = ((await made.json()) as { data: { id: string } }).data.id;
  }
  const title = `Star ${Date.now()}`;
  const created = await page.request.post(`${apiURL()}/api/v1/documents`, {
    headers: {
      ...auth,
      "X-Workspace-Id": workspaceID,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      title,
      type: "architecture",
      isDraft: true,
      contentJSON: { version: 1, nodes: [], connections: [] },
    },
  });
  expect(created.ok()).toBeTruthy();

  await page.goto("/dashboard");
  const card = page
    .locator("div.group.cursor-pointer")
    .filter({ hasText: title });
  await expect(card).toBeVisible({ timeout: 20000 });
  await card.getByRole("button", { name: "Star Document" }).click();

  // The card shows the star, and the sidebar lists the document.
  await expect(
    card.getByRole("button", { name: "Unstar Document" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.locator('[data-sidebar="sidebar"]').getByText(title).first(),
  ).toBeVisible();

  // The server kept it.
  await page.reload();
  await expect(
    page
      .locator("div.group.cursor-pointer")
      .filter({ hasText: title })
      .getByRole("button", { name: "Unstar Document" }),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    page.locator('[data-sidebar="sidebar"]').getByText(title).first(),
  ).toBeVisible();
});
