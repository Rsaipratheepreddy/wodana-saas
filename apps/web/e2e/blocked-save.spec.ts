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
    for (const field of ["Full name", "Email", "Lead source", "Mobile"]) await expect(alert).toContainText(field);
    await expect(page.getByLabel(/^Full name/)).toBeFocused();
    await expect(page.locator(".wd-field-error", { hasText: "Required" }).first()).toBeVisible();
    const mobile = page.getByRole("textbox", { name: /^Mobile/ });
    await mobile.fill("+44 7400 123456");
    await expect(page.getByRole("button", { name: "Mobile country code" })).toContainText("+44");
    await expect(mobile).toHaveValue("7400123456");
    await mobile.fill("74001234567");
    await mobile.blur();
    await expect(page.getByText(/Too long — United Kingdom mobile numbers are 10 digits after \+44/)).toBeVisible();
    await mobile.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`blocked-save-${direction}.png`), animations: "disabled" });
  });
}
