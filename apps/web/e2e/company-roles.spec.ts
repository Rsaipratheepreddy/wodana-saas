import { expect, test } from "@playwright/test";

test("roles and permissions stay usable at desktop and mobile sizes", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/workspace/roles");
  await page.context().addCookies([{
    name: "wodana_access",
    value: "local-e2e-fixture",
    url: new URL(page.url()).origin,
  }]);
  await page.goto("/workspace/roles");

  await expect(page.getByRole("heading", { level: 1, name: "Roles & permissions" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Quotations & finance 8" })).toBeVisible();
  await page.getByRole("button", { name: "Quotations & finance 8" }).click();
  const estimateSwitch = page.getByRole("switch", { name: "Studio lead: Approve QS quotation estimate" });
  await expect(estimateSwitch).toBeVisible();
  await estimateSwitch.focus();
  await page.keyboard.press("Space");
  await expect(estimateSwitch).toBeChecked();
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(estimateSwitch).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Custom role" })).toBeVisible();

  const controlHeight = (await page.getByRole("button", { name: "Custom role" }).boundingBox())?.height ?? 0;
  if (testInfo.project.name === "desktop") expect(controlHeight).toBeLessThanOrEqual(36);
  await page.getByRole("button", { name: "Custom role" }).click();
  const roleDialog = page.getByRole("dialog", { name: "Create custom role" });
  await expect(roleDialog).toBeVisible();
  const roleNameHeight = (await roleDialog.getByRole("textbox", { name: "Role name" }).boundingBox())?.height ?? 0;
  expect(roleNameHeight).toBeLessThanOrEqual(40);
  await roleDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(roleDialog).not.toBeVisible();
  if (testInfo.project.name === "mobile") {
    const accessColumn = page.getByRole("columnheader", { name: "Access" });
    await expect(accessColumn).toBeVisible();
    const box = await estimateSwitch.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("company-roles.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.evaluate(() => { document.documentElement.dir = "rtl"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
