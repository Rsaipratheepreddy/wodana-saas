import { expect, test } from "@playwright/test";
import { hrmsFixture } from "./hrms-fixture";

test("HRMS opens below Projects in the shared portal", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await hrmsFixture(page);
  await page.goto("/workspace/hrms");
  if (new URL(page.url()).pathname === "/login") {
    const session = await page.request.post("/api/auth/login", { data: {
      email: "admin@igloarchitects.com",
      password: "IgloDemo#2026",
      tenantSlug: "iglo-architects",
    } });
    expect(session.ok()).toBe(true);
    await page.goto("/workspace/hrms");
  }

  await expect(page.getByRole("heading", { level: 1, name: "HRMS" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ready for your workday?" })).toBeVisible();
  if (testInfo.project.name === "mobile") {
    if (await page.getByRole("button", { name: "Open navigation" }).count()) await page.getByRole("button", { name: "Open navigation" }).click();
  }
  await page.getByRole("button", { name: "Switch module. Current: HRMS" }).click();
  const chooser = page.getByRole("dialog", { name: "Choose module" });
  const destinations = await chooser.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(destinations.slice(-2)).toEqual(["/workspace/projects", "/workspace/hrms"]);
  await expect(chooser.getByRole("link", { name: /HRMS/ })).toHaveAttribute("aria-current", "page");
  await chooser.getByRole("link", { name: /Projects/ }).click();
  await expect(page).toHaveURL(/\/workspace\/projects$/);

  if (testInfo.project.name === "mobile") {
    if (await page.getByRole("button", { name: "Open navigation" }).count()) await page.getByRole("button", { name: "Open navigation" }).click();
  }
  const switcher = page.getByRole("button", { name: "Switch module. Current: Projects" });
  await switcher.focus();
  await switcher.press("Enter");
  await page.getByRole("dialog", { name: "Choose module" }).getByRole("link", { name: /HRMS/ }).click();
  await expect(page).toHaveURL(/\/workspace\/hrms$/);
  await expect(page.getByRole("heading", { level: 1, name: "HRMS" })).toBeVisible();

  for (const theme of ["light", "dark"]) {
    const toggle = page.getByRole("button", { name: `Use ${theme} mode` });
    if (await toggle.count()) await toggle.click();
    await page.goto("/workspace/hrms/leave");
    await expect(page.getByRole("heading", { name: "Recent leave" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`hrms-${theme}.png`) });
    if (testInfo.project.name === "mobile") {
      if (await page.getByRole("button", { name: "Open navigation" }).count()) await page.getByRole("button", { name: "Open navigation" }).click();
    }
    await page.getByRole("button", { name: "Switch module. Current: HRMS" }).click();
    const moduleChooser = page.getByRole("dialog", { name: "Choose module" });
    const icons = await moduleChooser.locator("[data-module]").evaluateAll((elements) => elements.map((element) => ({
      background: getComputedStyle(element).backgroundImage,
      color: getComputedStyle(element).color,
    })));
    expect(icons).toHaveLength(5);
    expect(new Set(icons.map((icon) => icon.background)).size).toBe(5);
    for (const icon of icons) {
      expect(icon.background).toContain("linear-gradient");
      // A translucent neutral wash softens only module tiles, not their icons.
      expect(icon.background).toMatch(/(?:0\.42|42%)/);
      expect(icon.background).toMatch(/214, 185, 243|228, 162, 188|243, 155, 84/);
      expect(icon.color).toBe("rgb(47, 35, 45)");
    }
    await page.screenshot({ path: testInfo.outputPath(`module-gradients-${theme}.png`) });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Switch module. Current: HRMS" })).toBeFocused();
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Close navigation" }).click();
    }
  }
  await page.evaluate(() => { document.documentElement.dir = "rtl"; });
  await expect(page.getByRole("heading", { level: 1, name: "HRMS" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
