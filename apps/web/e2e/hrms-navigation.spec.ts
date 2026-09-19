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
  const mobile = testInfo.project.name === "mobile";
  if (mobile) {
    await page.getByRole("button", { name: "Switch module. Current: HRMS" }).click();
    const chooser = page.getByRole("dialog", { name: "Choose module" });
    const destinations = await chooser.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(destinations.slice(-2)).toEqual(["/workspace/projects", "/workspace/hrms"]);
    await expect(chooser.getByRole("link", { name: /HRMS/ })).toHaveAttribute("aria-current", "page");
    await chooser.getByRole("link", { name: /Projects/ }).click();
  } else {
    const modules = page.getByRole("navigation", { name: "Modules" });
    const destinations = await modules.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(destinations.slice(-2)).toEqual(["/workspace/projects", "/workspace/hrms"]);
    await expect(modules.getByRole("link", { name: "HRMS", exact: true })).toHaveAttribute("aria-current", "page");
    await modules.getByRole("link", { name: "Projects", exact: true }).click();
  }
  await expect(page).toHaveURL(/\/workspace\/projects$/);

  if (mobile) {
    const switcher = page.getByRole("button", { name: "Switch module. Current: Projects" });
    await switcher.focus();
    await switcher.press("Enter");
    await page.getByRole("dialog", { name: "Choose module" }).getByRole("link", { name: /HRMS/ }).click();
  } else {
    await page.getByRole("navigation", { name: "Modules" }).getByRole("link", { name: "HRMS", exact: true }).click();
  }
  await expect(page).toHaveURL(/\/workspace\/hrms$/);
  await expect(page.getByRole("heading", { level: 1, name: "HRMS" })).toBeVisible();

  for (const theme of ["light", "dark"]) {
    const toggle = page.getByRole("button", { name: `Use ${theme} mode` });
    if (await toggle.count()) await toggle.click();
    await page.goto("/workspace/hrms/leave");
    await expect(page.getByRole("heading", { name: "Recent leave" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`hrms-${theme}.png`) });
    if (mobile) {
      await page.getByRole("button", { name: "Switch module. Current: HRMS" }).click();
      const moduleChooser = page.getByRole("dialog", { name: "Choose module" });
      const backgrounds = await moduleChooser.locator("[data-module]").evaluateAll((elements) => elements.map((element) => getComputedStyle(element).backgroundImage));
      expect(backgrounds).toEqual(Array(5).fill("none"));
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Switch module. Current: HRMS" })).toBeFocused();
    } else {
      const modules = page.getByRole("navigation", { name: "Modules" });
      await expect(modules.getByRole("link", { name: "HRMS", exact: true })).toHaveAttribute("aria-current", "page");
      const selectedBackground = await modules.getByRole("link", { name: "HRMS", exact: true }).evaluate((element) => getComputedStyle(element).backgroundImage);
      expect(selectedBackground).toBe("none");
    }
  }
  await page.evaluate(() => { document.documentElement.dir = "rtl"; });
  await expect(page.getByRole("heading", { level: 1, name: "HRMS" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
