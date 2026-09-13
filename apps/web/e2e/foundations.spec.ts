import { expect, test } from "@playwright/test";

test.describe("web foundations", () => {
  test("loads the font, theme tokens and root transition without runtime errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Beautiful spaces. Beautifully managed." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Log in", exact: true })).toHaveAttribute("href", "/login");

    const foundation = await page.evaluate(() => {
      const rootStyle = getComputedStyle(document.documentElement);
      const bodyStyle = getComputedStyle(document.body);
      return {
        animationName: bodyStyle.animationName,
        canvas: rootStyle.getPropertyValue("--wd-color-canvas").trim(),
        direction: document.documentElement.dir,
        fontFamily: bodyStyle.fontFamily,
        hasAppRoot: document.body.hasAttribute("data-app-root"),
        theme: document.documentElement.dataset.theme,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

    expect(foundation).toMatchObject({
      animationName: "wd-root-enter",
      canvas: "#f8faf9",
      direction: "ltr",
      hasAppRoot: true,
      overflow: 0,
      theme: "light",
    });
    expect(foundation.fontFamily).toContain("Inter");
    expect(errors).toEqual([]);
  });

  test("keeps the foundation within a 320px mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Beautiful spaces. Beautifully managed." })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
