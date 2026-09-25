import { expect, test } from "@playwright/test";

test("Sales preparation and Approvals are reachable without leaving the workspace", async ({ page }) => {
  await page.goto("/workspace/crm/preparation");
  await expect(page.getByRole("navigation", { name: "Sales sections" }).getByRole("link", { name: "Preparation" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("region", { name: "Sales preparation workspace" })).toBeVisible();

  await page.goto("/workspace/approvals");
  await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Approval sources" }).getByRole("link", { name: "Case decisions" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("navigation", { name: "Approval sources" }).getByRole("link", { name: "Project requests" }).click();
  await expect(page.getByRole("navigation", { name: "Approval sources" }).getByRole("link", { name: "Project requests" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("table", { name: "Global project approvals" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Use dark mode" }).click();
  await expect(page.getByRole("button", { name: "Use light mode" })).toBeVisible();
  await page.evaluate(() => { document.documentElement.dir = "rtl"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
