import { expect, test } from "@playwright/test";

test("legacy catalog URL resolves to the current room-to-material Master Data flow", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const session = await page.request.post("/api/auth/login", { data: {
    email: "admin@igloarchitects.com", password: "IgloDemo#2026", tenantSlug: "iglo-architects",
  } });
  expect(session.ok()).toBe(true);
  await page.goto("/workspace/pre-projects/catalogs");
  await expect(page).toHaveURL(/\/workspace\/pre-projects\/master-data$/);
  await expect(page.getByRole("heading", { level: 1, name: "Master Data", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Room grid", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New catalog" })).toHaveCount(0);
  await expect(page.locator("select")).toHaveCount(0);

  await page.getByRole("button", { name: "Open Workplace", exact: true }).click();
  const items = page.getByRole("table", { name: "Items", exact: true });
  await expect(items).toContainText("Workstations with cable management");
  await items.getByRole("button", { name: "Open Workstations with cable management", exact: true }).click();
  await page.getByRole("button", { name: "Open Standard workstation", exact: true }).click();
  const materials = page.getByRole("region", { name: "Materials", exact: true });
  await expect(materials.getByRole("table", { name: "Item materials", exact: true })).toContainText("MR plywood");

  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("master-data-drill-down.png") });
  expect(errors).toEqual([]);
});
