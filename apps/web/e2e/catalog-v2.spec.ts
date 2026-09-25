import { expect, test } from "@playwright/test";

const overflow = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

for (const [language, direction] of [["en", "ltr"], ["ar", "rtl"]] as const) {
  test(`catalog grid, categories, item detail and import ${direction}`, async ({ page, context, baseURL }, testInfo) => {
    await context.addCookies([{ name: "wodana_language", value: language, url: baseURL! }]);
    await page.goto("/workspace/catalogs");
    await expect(page.getByRole("heading", { name: "Materials" })).toBeVisible();
    const grid = page.getByRole("region", { name: "Items" });
    await expect(grid.getByText("Birch plywood (Sveza) 12mm")).toBeVisible();
    await expect(grid.getByText("Price unavailable").first()).toBeVisible();
    await page.getByRole("navigation", { name: "Categories" }).getByRole("button", { name: "Joinery" }).click();
    await expect(grid.getByText("Hinged wardrobe")).toBeVisible();
    await expect(grid.getByText("Birch plywood (Sveza) 12mm")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`catalog-${direction}.png`), animations: "disabled" });

    await grid.getByText("Hinged wardrobe").click();
    await expect(page.getByText("ceil(height / 450) * 2")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`catalog-item-${direction}.png`), animations: "disabled" });
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Import" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Import items" });
    await dialog.getByLabel("Choose a spreadsheet").setInputFiles({ name: "paint.csv", mimeType: "text/csv", buffer: Buffer.from("SERIAL NO.,UNIT,MORAL CODE,COLOR,ITEM NAME\n1,LITER,CP 003,,CP 003 Catalyst @ 50%\n2,LITER,CP 003,,CP 003 Catalyst @ 50% NY\n3,,,WHITE,Teflon Tape\n") });
    await expect(dialog.getByText(/Code/).first()).toBeVisible();
    await dialog.getByRole("button", { name: "Review" }).click();
    await expect(dialog.getByRole("status")).toContainText("need a fix");
    await expect(dialog.getByText("Code is also used on line 3 for a different item")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`catalog-import-${direction}.png`), animations: "disabled" });
    await dialog.getByRole("button", { name: /^Import \d+/ }).click();
    await expect(dialog).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 860 });
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`catalog-mobile-${direction}.png`), animations: "disabled" });
  });
}
