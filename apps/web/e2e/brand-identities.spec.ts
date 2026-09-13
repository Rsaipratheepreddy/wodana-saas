import { expect, test } from "@playwright/test";

test("uses one identity palette in the sidebar, organization, members and CRM", async ({ page }, testInfo) => {
  await page.goto("/workspace");
  if (new URL(page.url()).pathname === "/login") {
    expect((await page.request.post("/api/auth/login", { data: { email: "admin@igloarchitects.com", password: "IgloDemo#2026", tenantSlug: "iglo-architects" } })).ok()).toBe(true);
    await page.goto("/workspace");
  }
  const profile = page.getByRole("region", { name: "Org profile workspace" });
  await expect(profile).toBeVisible();
  const workspaceMark = page.locator("[data-workspace-mark]").first();
  const companyMark = profile.locator('[class*="logoPreview"]');
  if (!(await companyMark.getAttribute("data-has-logo"))) {
    await expect(companyMark).toHaveText("IA");
    await expect(workspaceMark).toHaveText("IA");
    expect(await companyMark.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe(await workspaceMark.evaluate((el) => getComputedStyle(el).backgroundImage));
  }
  const woddy = page.getByRole("button", { name: "Ask Woddy" }).locator("img");
  await expect(woddy).toHaveAttribute("src", /woddy-mark-v4\.png/);
  await page.screenshot({ path: testInfo.outputPath("organization-brand.png"), animations: "disabled" });

  await page.goto("/workspace/members");
  const member = page.getByRole("img", { name: "Iglo Administrator" }).first();
  await expect(member).toBeVisible();
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("dialog", { name: "Mobile workspace navigation" })).toBeVisible();
  }
  const sidebarUser = page.locator('[class*="sidebarFooter"] [style*="--wd-identity-gradient-"]').first();
  const managerGradient = await member.evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(await sidebarUser.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe(managerGradient);

  await page.goto("/workspace/crm/leads");
  const manager = page.locator('.wd-avatar[aria-label="Iglo Administrator"]:visible').first();
  await expect(manager).toBeVisible();
  expect(await manager.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe(managerGradient);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    const avatars = await page.locator(".wd-avatar").evaluateAll((elements) => elements.map((el) => ({
      name: el.getAttribute("aria-label"), gradient: getComputedStyle(el).backgroundImage, ink: getComputedStyle(el).color,
    })));
    expect(avatars.length).toBeGreaterThan(2);
    expect(new Set(avatars.map((avatar) => avatar.gradient)).size).toBeGreaterThan(1);
    for (const avatar of avatars) {
      expect(avatar.gradient).toContain("linear-gradient");
      // Only the existing lilac, rose and peach brand stops; no blue/green fallbacks.
      const stops = avatar.gradient.match(/rgb\([^)]+\)/g) ?? [];
      expect(stops.length).toBeGreaterThanOrEqual(2);
      for (const stop of stops) expect(["rgb(214, 185, 243)", "rgb(228, 162, 188)", "rgb(243, 155, 84)"]).toContain(stop);
      expect(avatar.ink).toBe("rgb(47, 35, 45)");
    }
    await page.screenshot({ path: testInfo.outputPath(`lead-identities-${theme}.png`), animations: "disabled" });
  }
});

test("avatar initials retain accessible contrast and honor high contrast", async ({ page }) => {
  await page.goto("/design-system");
  const avatars = page.locator(".wd-avatar");
  await expect(avatars.first()).toBeVisible();
  const ratio = (foreground: number[], background: number[]) => {
    const luminance = (rgb: number[]) => rgb.map((channel) => channel / 255).map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
    return (luminance(background) + .05) / (luminance(foreground) + .05);
  };
  for (const stop of [[214, 185, 243], [228, 162, 188], [243, 155, 84]]) expect(ratio([47, 35, 45], stop)).toBeGreaterThanOrEqual(4.5);
  await page.locator(".wd-root").evaluate((el) => { (el as HTMLElement).dataset.wdTheme = "high-contrast"; });
  await expect(avatars.first()).toHaveCSS("background-image", "none");
  await expect(avatars.first()).toHaveCSS("color", "rgb(0, 0, 0)");
  await page.emulateMedia({ forcedColors: "active" });
  await expect(avatars.first()).toHaveCSS("background-image", "none");
});
