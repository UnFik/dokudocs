import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { mailedToken } from "../../../support/workspace-invites";

const apiURL = process.env.API_URL ?? "http://localhost:8080";
const password = "password12345678";

async function register(email: string, fullName: string) {
  const response = await fetch(`${apiURL}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, fullName }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { data: { accessToken: string } }).data.accessToken;
}

// The whole path a new person takes: invited by email in Settings, opens the
// link, creates the account, verifies the address and lands in the workspace.
test("@live @smoke: an owner invites a new person by email and they join the workspace", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 8);
  const ownerEmail = `invite-owner-${suffix}@example.invalid`;
  const guestEmail = `invite-guest-${suffix}@example.invalid`;
  const workspaceName = `Invite flow ${suffix}`;
  const ownerToken = await register(ownerEmail, "Olivia Owner");
  const created = await fetch(`${apiURL}/api/v1/workspaces`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: workspaceName, plan: "Pro Workspace" }),
  });
  expect(created.status).toBe(201);

  // The owner sends the invitation from Settings.
  const ownerPage = await (await browser.newContext()).newPage();
  await ownerPage.goto("/sign-in");
  await ownerPage.locator('input[name="email"]').fill(ownerEmail);
  await ownerPage.locator('input[name="password"]').fill(password);
  await ownerPage.getByRole("button", { name: /sign in/i }).click();
  await ownerPage.waitForURL((url) => url.pathname === "/dashboard");
  await ownerPage.goto("/settings");
  await ownerPage.getByRole("tab", { name: "Members" }).click();
  await ownerPage.getByRole("button", { name: "Invite by email" }).click();
  await ownerPage.getByLabel("Email address").fill(guestEmail);
  await ownerPage.getByRole("button", { name: "Send invitation" }).click();
  await expect(ownerPage.getByText(guestEmail, { exact: true })).toBeVisible();

  // The guest opens the mailed link and sees what it offers before signing up.
  const inviteToken = await mailedToken(guestEmail, "invite");
  const guestPage = await (await browser.newContext()).newPage();
  await guestPage.goto(`/invite?token=${inviteToken}`);
  await expect(guestPage.getByRole("heading", { name: `Join ${workspaceName}` })).toBeVisible();
  expect(new URL(guestPage.url()).search, "the token left the address bar").toBe("");
  await guestPage.getByRole("link", { name: "Create an account" }).click();
  await guestPage.getByLabel("Full Name").fill("Gina Guest");
  await guestPage.getByLabel("Email").fill(guestEmail);
  await guestPage.getByLabel("Password", { exact: true }).fill(password);
  await guestPage.getByLabel("Confirm Password").fill(password);
  await guestPage.getByRole("button", { name: /create account/i }).click();

  // The address is not verified yet, so the app asks for that first.
  await guestPage.waitForURL((url) => url.pathname === "/verify-email");
  const verifyToken = await mailedToken(guestEmail, "verify-email");
  await guestPage.goto(`/verify-email?token=${verifyToken}`);
  await expect(guestPage.getByText("You joined the workspace.")).toBeVisible();

  // The owner now sees the guest as a member, and no invitation waiting.
  await ownerPage.reload();
  await ownerPage.getByRole("tab", { name: "Members" }).click();
  await expect(ownerPage.getByText("Gina Guest", { exact: true })).toBeVisible();
  await expect(ownerPage.getByText("No invitations are waiting.", { exact: false })).toBeVisible();
});
