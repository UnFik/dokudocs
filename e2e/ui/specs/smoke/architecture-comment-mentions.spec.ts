import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

// Typing @ in a canvas comment offers the people of the workspace, narrows as the
// name is typed, and stores the person as a token that shows as a name.

const apiURL = () => process.env.API_URL ?? "http://localhost:8080";

test("@live @smoke @comments: @ in a canvas comment offers the workspace, narrows, and mentions a member", async ({ page, browser }) => {
  test.setTimeout(120000);
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await page.goto("/sign-in");
  await page.locator('input[name="email"]').fill("admin@example.com");
  await page.locator('input[name="password"]').fill("password123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname === "/dashboard");
  await page.getByRole("button", { name: /workspace/i }).first().click();
  await page.getByRole("menuitem", { name: "Create Workspace" }).click();
  await page.getByLabel("Workspace Name").fill(`Mention workspace ${suffix}`);
  const workspaceResponse = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/workspaces",
  );
  await page.getByRole("button", { name: "Create Workspace" }).click();
  const workspaceID = ((await (await workspaceResponse).json()) as { data: { id: string } }).data.id;
  const token = (await page.context().cookies()).find((c) => c.name === "thisisjustarandomstring")!.value;
  const owner = { Authorization: `Bearer ${token}`, "X-Workspace-Id": workspaceID };

  // Two more people in the workspace, and one who is not.
  const person = async (fullName: string) => {
    const email = `mention-${randomUUID()}@example.invalid`;
    const response = await page.request.post(`${apiURL()}/api/v1/auth/register`, {
      data: { email, password: "password12345678", fullName },
    });
    expect(response.status()).toBe(201);
    return { email, id: ((await response.json()) as { data: { user: { id: string } } }).data.user.id };
  };
  const dewi = await person("Dewi Lestari");
  const dimas = await person("Dimas Anggara");
  const outsider = await person("Zed Outsider");
  for (const member of [dewi, dimas]) {
    const invite = await page.request.post(`${apiURL()}/api/v1/workspaces/${workspaceID}/invites`, {
      headers: owner,
      data: { email: member.email, role: "member" },
    });
    expect(invite.status()).toBe(201);
  }

  const system = randomUUID();
  const created = await page.request.post(`${apiURL()}/api/v1/documents`, {
    headers: { ...owner, "Idempotency-Key": randomUUID() },
    data: {
      title: `Mentions ${suffix}`,
      type: "architecture",
      isDraft: false,
      visibility: "workspace",
      contentJSON: {
        version: 1,
        nodes: [{ id: system, kind: "system", name: "Backend", catalog: "golang", x: 200, y: 160, parentId: null }],
        connections: [],
      },
    },
  });
  expect(created.status()).toBe(201);
  const documentID = ((await created.json()) as { data: { id: string } }).data.id;

  await page.goto(`/docs/${documentID}?workspaceId=${workspaceID}`);
  await expect(page.getByText("Editing together")).toBeVisible({ timeout: 20000 });
  await page.locator(".react-flow__node-system").filter({ hasText: "Backend" }).click();
  const properties = page.locator("#architecture-properties");
  const box = properties.getByLabel("New comment on Backend");
  await box.click();
  await page.keyboard.type("cc @");

  // Everyone in the workspace is offered, and no one outside it.
  const list = page.getByRole("listbox", { name: "People to mention" });
  await expect(list).toBeVisible();
  await expect(list.getByRole("option", { name: /Dewi Lestari/ })).toBeVisible();
  await expect(list.getByRole("option", { name: /Dimas Anggara/ })).toBeVisible();
  await expect(list.getByRole("option", { name: /Zed Outsider/ })).toHaveCount(0);

  // The list narrows as the name grows.
  await page.keyboard.type("dew");
  await expect(list.getByRole("option", { name: /Dewi Lestari/ })).toBeVisible();
  await expect(list.getByRole("option", { name: /Dimas Anggara/ })).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(box).toHaveValue("cc @Dewi Lestari ");
  await expect(list).toHaveCount(0);
  await page.keyboard.type("can you check?");

  await properties.getByRole("button", { name: "Comment", exact: true }).click();
  const chip = properties.locator("[data-mention]");
  await expect(chip).toHaveText("@Dewi Lestari");
  await expect(chip).toHaveAttribute("data-mention", dewi.id);
  await expect(properties).not.toContainText("user:");

  // What is stored is the token with the member's id.
  const comments = await page.request.get(`${apiURL()}/api/v1/documents/${documentID}/comments`, { headers: owner });
  const stored = ((await comments.json()) as { data: { content: string }[] }).data;
  expect(stored[0].content).toBe(`cc @[Dewi Lestari](user:${dewi.id}) can you check?`);

  // Someone outside the workspace cannot be named, even by hand.
  const forged = await page.request.post(`${apiURL()}/api/v1/documents/${documentID}/comments`, {
    headers: owner,
    data: {
      threadID: randomUUID(),
      selectedText: "Backend",
      content: `hi @[Zed](user:${outsider.id})`,
      anchor: { kind: "element", elementId: system },
    },
  });
  expect(forged.status()).toBe(400);

  // The member finds it in the sidebar and opens the thread from there.
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await memberPage.goto("/sign-in");
  await memberPage.locator('input[name="email"]').fill(dewi.email);
  await memberPage.locator('input[name="password"]').fill("password12345678");
  await memberPage.getByRole("button", { name: /sign in/i }).click();
  await memberPage.waitForURL((url) => url.pathname === "/dashboard");
  const inbox = memberPage.getByRole("button", { name: /^Notifications/ });
  await expect(inbox).toContainText("1 new");
  await inbox.click();
  await memberPage.getByRole("button", { name: /mentioned you in/ }).click();
  await memberPage.waitForURL((url) => url.pathname === `/docs/${documentID}` && url.searchParams.has("thread"));
  const memberProperties = memberPage.locator("#architecture-properties");
  await expect(memberProperties).toContainText("can you check?", { timeout: 20000 });
  await expect(memberProperties.locator("[data-mention]")).toHaveText("@Dewi Lestari");
  await memberContext.close();

  // Escape closes the list and nothing else.
  await box.click();
  await page.keyboard.type("@di");
  await expect(list).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(box).toHaveValue("@di");
});
