import { expect, test } from "@playwright/test";

test("Wodana Control sign-in is separate, responsive, and works in both themes", async ({ page }) => {
  await page.goto("/internal/sign-in");
  await expect(page.getByRole("heading", { name: "Wodana Control" })).toBeVisible();
  await expect(page.getByLabel("Work email")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Password" })).toBeVisible();
  await expect(page.getByText("workspace", { exact: true })).toHaveCount(0);
  await expect(page.locator(".wd-root")).toHaveAttribute("data-wd-theme", "light");
  await page.getByRole("button", { name: "Use dark mode" }).click();
  await expect(page.locator(".wd-root")).toHaveAttribute("data-wd-theme", "dark");
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflows).toBe(false);
});

test("password stage leads to an authenticator challenge", async ({ page }) => {
  await page.route("**/api/internal/auth/login", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ challengeToken: "test-challenge", purpose: "login" }),
    });
  });
  await page.goto("/internal/sign-in");
  await page.getByLabel("Work email").fill("operator@wodana.test");
  await page.getByRole("textbox", { name: "Password" }).fill("test-password");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Verify it's you" })).toBeVisible();
  await expect(page.getByLabel("Authenticator code")).toBeVisible();
  await page.getByRole("button", { name: "Use a recovery code" }).click();
  await expect(page.getByLabel("Recovery code")).toBeVisible();
});
