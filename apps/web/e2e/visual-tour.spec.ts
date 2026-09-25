import { test } from "@playwright/test";

// Screenshot tour of core screens in light and dark, for design review of tokens and co-branding.
const screens = ["/workspace", "/workspace/tasks", "/workspace/projects", "/workspace/crm", "/workspace/company", "/workspace/settings/client-portal"];

for (const theme of ["light", "dark"] as const) {
  test(`visual tour ${theme}`, async ({ page }, testInfo) => {
    await page.addInitScript((value) => localStorage.setItem("wodana-theme", value), theme);
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 1280, height: 820 });
    for (const path of screens) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: testInfo.outputPath(`${theme}${path.replaceAll("/", "_")}.png`), animations: "disabled" });
    }
  });
}
