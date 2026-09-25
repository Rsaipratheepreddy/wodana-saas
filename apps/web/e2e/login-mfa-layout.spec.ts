import { expect, test } from "@playwright/test";

test("authenticator setup is compact, uses one-line key and has a working back path", async ({ page }, testInfo) => {
  await page.route("**/api/auth/login", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      authenticated: true,
      selectedWorkspaceId: "00000000-0000-4000-8000-000000000002",
      mfaEnrollmentRequired: true,
      mfaEnrollmentDeadline: "2027-09-27T00:00:00.000Z",
    }),
  }));
  await page.route("**/api/auth/mfa/setup", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      secret: "ABCDEFGHIJKLMNOPQRSTUVWX23456789",
      otpauthUri: "otpauth://totp/Wodana:test?secret=ABCDEFGHIJKLMNOPQRSTUVWX23456789",
      setupExpiresInSeconds: 600,
    }),
  }));
  await page.route("**/api/auth/logout", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ signedOut: true }),
  }));

  await page.goto("/login?tenant=missing-default-brand");
  await page.getByRole("textbox", { name: "Email" }).fill("owner@example.com");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("textbox", { name: "Password" }).fill("DemoPassword#2026");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Protect your account" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to sign in" })).toHaveAttribute("data-variant", "quiet");
  await expect(page.getByRole("button", { name: "Set up authenticator" })).toHaveAttribute("data-variant", "primary");
  await expect(page.getByRole("button", { name: "Back to sign in" })).toHaveCSS("text-decoration-line", "none");
  const primaryBox = await page.getByRole("button", { name: "Set up authenticator" }).boundingBox();
  const laterBox = await page.getByRole("button", { name: "Set up later" }).boundingBox();
  expect(laterBox?.width).toBe(primaryBox?.width);
  expect(laterBox?.height).toBe(primaryBox?.height);
  await page.getByRole("button", { name: "Set up authenticator" }).click();

  const key = page.getByLabel("Authenticator setup key");
  await expect(key).toBeVisible();
  await expect(key.locator("code")).toHaveText("ABCDEFGHIJKLMNOPQRSTUVWX23456789");
  await expect(key.getByRole("button", { name: "Copy setup key" })).toBeVisible();
  await expect(page.locator("details")).toHaveCount(0);
  const positions = await key.locator("span, code, button").evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
  expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(12);
  await page.screenshot({ path: testInfo.outputPath("compact-authenticator.png"), fullPage: true });

  await page.getByRole("group", { name: "One-time password" }).locator("input").first().click();
  await page.screenshot({ path: testInfo.outputPath("authenticator-focused.png") });
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Protect your account" })).toBeVisible();
  await page.getByRole("button", { name: "Back to sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});
