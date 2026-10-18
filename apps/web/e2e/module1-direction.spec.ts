import { expect, test } from "@playwright/test";

// Module 1 (workspace setup and sign-in) must render correctly left-to-right and right-to-left.
const overflow = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

for (const [language, direction] of [["en", "ltr"], ["ar", "rtl"]] as const) {
  test(`onboarding renders ${direction} without overflow`, async ({ page, context, baseURL }, testInfo) => {
    await context.addCookies([{ name: "wodana_language", value: language, url: baseURL! }]);
    await page.goto("/onboarding");
    const root = page.locator("[dir]").first();
    await expect(root).toHaveAttribute("dir", direction);
    await expect(page.getByRole("button").filter({ hasText: /./ }).first()).toBeVisible();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath(`onboarding-${direction}-${width}.png`), animations: "disabled" });
    }
  });
}

test("sign-in renders without overflow on desktop and phone", async ({ page }, testInfo) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`login-${width}.png`), animations: "disabled" });
  }
});
