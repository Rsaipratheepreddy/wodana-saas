import { expect, test } from "@playwright/test";

// Module 2 (settings) screens render left-to-right and right-to-left without overflow.
const overflow = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

for (const [language, direction] of [["en", "ltr"], ["ar", "rtl"]] as const) {
  test(`client portal settings render ${direction}`, async ({ page, context, baseURL }, testInfo) => {
    await context.addCookies([{ name: "wodana_language", value: language, url: baseURL! }]);
    await page.goto("/workspace/settings/client-portal");
    await expect(page.locator("html")).toHaveAttribute("dir", direction);
    await expect(page.getByRole("switch", { name: "Clients can sign in" })).toBeVisible();
    await expect(page.getByLabel(/^Welcome title/)).toBeVisible();
    await expect(page.locator('input[type="color"]')).toHaveCount(0);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath(`portal-settings-${direction}-${width}.png`), animations: "disabled", fullPage: true });
    }
  });
}

for (const [language, direction] of [["en", "ltr"], ["ar", "rtl"]] as const) {
  test(`company profile shows the brand colour ${direction}`, async ({ page, context, baseURL }, testInfo) => {
    await context.addCookies([{ name: "wodana_language", value: language, url: baseURL! }]);
    await page.goto("/workspace/company");
    await expect(page.locator("html")).toHaveAttribute("dir", direction);
    await expect(page.getByLabel("Brand colour")).toBeAttached();
    await expect(page.getByText(/^#[0-9A-F]{6}/)).toBeVisible();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath(`company-${direction}-${width}.png`), animations: "disabled" });
    }
  });
}

test("long dropdowns open the full list on click and filter as you type", async ({ page }, testInfo) => {
  await page.goto("/workspace/company");
  await page.getByRole("button", { name: "Edit profile" }).click();
  const dialog = page.getByRole("dialog");
  const currency = dialog.getByRole("combobox", { name: "Base currency" });
  await currency.click();
  const options = page.getByRole("option");
  expect(await options.count()).toBeGreaterThan(20);
  await currency.fill("dirham");
  await expect(page.getByRole("option", { name: /United Arab Emirates Dirham/ })).toBeVisible();
  await currency.fill("zzzz");
  await expect(page.getByText("No matches")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("long-dropdown.png"), animations: "disabled" });
});

for (const [language, direction] of [["en", "ltr"], ["ar", "rtl"]] as const) {
  test(`tax and numbering per business ${direction}`, async ({ page, context, baseURL }, testInfo) => {
    await context.addCookies([{ name: "wodana_language", value: language, url: baseURL! }]);
    await page.goto("/workspace/legal-entities");
    await page.getByRole("button", { name: /^Tax & numbering/ }).first().click();
    const sheet = page.getByRole("dialog", { name: "Tax & numbering" });
    await expect(sheet.getByText(/VAT is not set up yet/)).toBeVisible();
    await expect(sheet.getByText("TRN:")).toBeVisible();
    await sheet.getByRole("button", { name: "Add rate" }).click();
    await sheet.getByRole("textbox", { name: /^Rate/ }).fill("5");
    await sheet.getByRole("button", { name: "Save tax" }).click();
    await expect(sheet.getByText(/New rates apply from now/)).toBeVisible();
    const prefix = sheet.getByRole("textbox", { name: /^Prefix/ }).first();
    await prefix.fill("PL-Q-{YYYY}-");
    await expect(sheet.getByText(new RegExp(`PL-Q-${new Date().getFullYear()}-00001`))).toBeVisible();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath(`tax-${direction}-${width}.png`), animations: "disabled" });
    }
  });
}
