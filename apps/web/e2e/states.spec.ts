import { expect, test } from "@playwright/test";

for (const scheme of ["light", "dark"] as const) {
  test(`state illustrations ${scheme}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/design-system");
    if (scheme === "dark") await page.evaluate(() => document.querySelectorAll("[data-wd-theme]").forEach((node) => node.setAttribute("data-wd-theme", "dark")));
    const gallery = page.getByTestId("state-gallery");
    await gallery.scrollIntoViewIfNeeded();
    await expect(gallery.locator("svg.wd-illustration")).toHaveCount(8);
    await gallery.screenshot({ path: testInfo.outputPath(`states-${scheme}.png`), animations: "disabled" });
  });
}
