import { expect, test } from "@playwright/test";

// A blocked save is never silent: the banner names the missing required fields (including dropdowns)
// and each field shows why. Runs against the design-system input module, which uses native validation.
for (const [language, direction] of [["en", "ltr"], ["ar", "rtl"]] as const) {
  test(`required fields explain a blocked save ${direction}`, async ({ page, context, baseURL }, testInfo) => {
    await context.addCookies([{ name: "wodana_language", value: language, url: baseURL! }]);
    await page.goto("/design-system");
    const submit = page.getByRole("button", { name: /^Submit/ });
    await submit.scrollIntoViewIfNeeded();
    await submit.click();
    const alert = page.locator(".wd-blocked-save");
    await expect(alert).toBeVisible();
    for (const field of ["Full name", "Email", "Lead source"]) await expect(alert).toContainText(field);
    await expect(page.getByLabel(/^Full name/)).toBeFocused();
    await expect(page.locator(".wd-field-error", { hasText: "Required" }).first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`blocked-save-${direction}.png`), animations: "disabled" });
  });
}
