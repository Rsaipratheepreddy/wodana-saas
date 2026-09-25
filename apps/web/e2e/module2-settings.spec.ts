import { expect, test } from "@playwright/test";

// Module 2 (settings) screens render left-to-right and right-to-left without overflow.
const overflow = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

for (const [language, direction] of [["en", "ltr"], ["ar", "rtl"]] as const) {
  test(`client portal settings render ${direction}`, async ({ page, context, baseURL }, testInfo) => {
    await context.addCookies([{ name: "wodana_language", value: language, url: baseURL! }]);
    await page.goto("/workspace/settings/client-portal");
    await expect(page.locator("html")).toHaveAttribute("dir", direction);
    await expect(page.getByRole("switch")).toBeVisible();
    await expect(page.getByLabel(/^Welcome title/)).toBeVisible();
    await expect(page.locator('input[type="color"]')).toHaveCount(0);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath(`portal-settings-${direction}-${width}.png`), animations: "disabled", fullPage: true });
    }
  });
}
