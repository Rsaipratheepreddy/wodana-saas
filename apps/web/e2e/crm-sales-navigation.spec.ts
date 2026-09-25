import { expect, test } from "@playwright/test";

test("Sales Pipeline keeps the conversion entry point visible without a standalone deal action", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/workspace/crm/opportunities");
  if (new URL(page.url()).pathname === "/login") {
    const session = await page.request.post("/api/auth/login", { data: {
      email: process.env.E2E_LOGIN_EMAIL ?? "admin@igloarchitects.com",
      password: process.env.E2E_LOGIN_PASSWORD ?? "IgloDemo#2026",
      tenantSlug: "iglo-architects",
    } });
    expect(session.ok()).toBe(true);
    await page.goto("/workspace/crm/opportunities");
  }
  await expect(page.getByRole("heading", { name: "Pipeline", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Convert enquiry" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New deal" })).toHaveCount(0);
  await expect(page.getByLabel("Sales pipeline board")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "List", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("table", { name: "Opportunities" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.evaluate(() => { document.documentElement.dir = "rtl"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
