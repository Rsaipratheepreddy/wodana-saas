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

test("sets a price, then QS reviews and it goes live", async ({ page }, testInfo) => {
  await page.goto("/workspace/catalogs");
  const grid = page.getByRole("region", { name: "Items" });
  await grid.getByText("Birch plywood (Sveza) 12mm").click();
  await page.getByRole("tab", { name: "Prices" }).click();
  await page.getByRole("button", { name: "Set price" }).click();
  await page.getByRole("textbox", { name: /^Price/ }).fill("185.50");
  await page.getByRole("button", { name: "Save price" }).click();
  await expect(page.getByText("Saved as a draft. It needs a review before it goes live.")).toBeVisible();
  await page.getByRole("button", { name: /^Close/ }).last().click();
  await grid.getByText("Salice soft-close hinge").click();
  await page.getByRole("tab", { name: "Prices" }).click();
  await expect(page.getByText("Live")).toBeVisible();
  await page.getByRole("button", { name: "Change" }).click();
  await page.getByRole("button", { name: /How it is priced/ }).click();
  await page.getByRole("option", { name: "Quantity tiers" }).click();
  await expect(page.getByRole("button", { name: "Add tier" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("catalog-prices.png"), animations: "disabled" });
});

test("import with AI clean-up or manually, and AI can be switched per workspace", async ({ page }, testInfo) => {
  await page.goto("/workspace/catalogs");
  await page.getByRole("button", { name: "Import" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Import items" });
  await dialog.getByLabel("Choose a spreadsheet").setInputFiles({ name: "stock.csv", mimeType: "text/csv", buffer: Buffer.from("UNIT,MORAL CODE,COLOR,ITEM NAME\n,W00004,,WHITE WOOD 2\"X2\"X13' [AED 15.50/PCS] - 522 PCS/BDL\nLITER,CP 004,,CP 004 CATALYST @ 50% FOR PU FULL GLOSSY\n,,WHITE,Teflon Tape\n") });
  await expect(dialog.getByRole("button", { name: "Review" })).toBeVisible();
  await dialog.getByRole("button", { name: "Clean up with AI" }).click();
  const list = dialog.getByRole("list", { name: "AI suggestions" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list.getByText("White wood 2\"x2\"x13'", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("catalog-ai-suggestions.png"), animations: "disabled" });
  await list.getByRole("listitem").nth(1).locator("label").first().click();
  await dialog.getByRole("button", { name: "Use 1 suggestions" }).click();
  await expect(dialog.getByRole("button", { name: "Review · 1 AI changes" })).toBeVisible();
  await dialog.getByRole("button", { name: "Review · 1 AI changes" }).click();
  await expect(dialog.getByRole("status")).toContainText("new");

  await page.goto("/workspace/company");
  await expect(page.getByRole("switch", { name: "AI assistance" })).toBeChecked();
  await expect(page.getByText("AI suggests; nothing changes until someone accepts.")).toBeVisible();
});
