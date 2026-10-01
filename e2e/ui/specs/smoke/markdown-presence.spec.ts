import { test, expect, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const apiURL = process.env.API_URL ?? "http://localhost:8080";

async function signIn(
  browser: Browser,
  baseURL: string,
  email: string,
  password: string,
) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname === "/");
  return { context, page };
}

async function openDocument(page: Page, documentID: string, workspaceID: string) {
  await page.goto(`/docs/${documentID}?workspaceId=${workspaceID}`);
  await expect(page.getByRole("status").first()).toContainText("Synced");
}

test("@live @smoke: users in the same Markdown document see each other's presence", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const baseURL = test.info().project.use.baseURL!;
  const suffix = `${Date.now()}`;
  const guest = {
    email: `presence_${suffix}@dokudocs.test`,
    password: "password12345678",
    fullName: `Presence Guest ${suffix}`,
  };

  const owner = await signIn(browser, baseURL, "admin@example.com", "password123");
  const ownerToken = (await owner.context.cookies()).find(
    (cookie) => cookie.name === "thisisjustarandomstring",
  )!.value;
  const ownerHeaders = { Authorization: `Bearer ${ownerToken}` };

  const workspaceResponse = await owner.page.request.post(
    `${apiURL}/api/v1/workspaces`,
    { headers: ownerHeaders, data: { name: `Presence ${suffix}`, plan: "Pro Workspace" } },
  );
  expect(workspaceResponse.status()).toBe(201);
  const workspaceID = ((await workspaceResponse.json()) as { data: { id: string } })
    .data.id;

  expect(
    (await owner.page.request.post(`${apiURL}/api/v1/auth/register`, { data: guest })).status(),
  ).toBe(201);
  const invite = await owner.page.request.post(
    `${apiURL}/api/v1/workspaces/${workspaceID}/invites`,
    { headers: ownerHeaders, data: { email: guest.email, role: "member" } },
  );
  expect(invite.status()).toBe(201);

  const documentID = randomUUID();
  const rootID = randomUUID();
  const paragraphID = randomUUID();
  const runID = randomUUID();
  const node = (
    nodeID: string,
    parentID: string | null,
    type: string,
    content = "",
  ) => ({ nodeID, parentID, siblingOrder: 1, type, content, attributes: {} });
  const created = await owner.page.request.post(`${apiURL}/api/v1/documents`, {
    headers: {
      ...ownerHeaders,
      "X-Workspace-Id": workspaceID,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      title: `Presence doc ${suffix}`,
      type: "markdown",
      isDraft: false,
      initialBody: {
        documentID,
        bodySchemaVersion: 1,
        rootNodeID: rootID,
        nodes: [
          node(rootID, null, "document"),
          node(paragraphID, rootID, "paragraph"),
          node(runID, paragraphID, "run", "shared"),
        ],
      },
    },
  });
  expect(created.status()).toBe(201);

  await openDocument(owner.page, documentID, workspaceID);
  const ownerList = owner.page.getByRole("list", {
    name: "People in this document",
  });
  await expect(ownerList.getByRole("listitem")).toHaveCount(1);
  await expect(
    ownerList.getByRole("listitem", { name: /\(you\)$/ }),
  ).toBeVisible();

  const visitor = await signIn(browser, baseURL, guest.email, guest.password);
  await openDocument(visitor.page, documentID, workspaceID);

  const visitorList = visitor.page.getByRole("list", {
    name: "People in this document",
  });
  await expect(ownerList.getByRole("listitem")).toHaveCount(2);
  await expect(visitorList.getByRole("listitem")).toHaveCount(2);
  await expect(
    ownerList.getByRole("listitem", { name: guest.fullName }),
  ).toBeVisible();
  await expect(
    visitorList.getByRole("listitem", { name: `${guest.fullName} (you)` }),
  ).toBeVisible();

  await visitor.page.close();
  await expect(ownerList.getByRole("listitem")).toHaveCount(1, {
    timeout: 15000,
  });
});
