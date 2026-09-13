import { expect, test } from "@playwright/test";
import axe from "axe-core";

test.describe("login UI", () => {
  test("opens recovery links, validates confirmation and returns to sign-in", async ({ page }) => {
    const resetToken = "release-recovery-token-that-is-long-enough";
    let submitted = false;
    await page.route("**/api/auth/reset-password", async (route) => {
      expect(route.request().postDataJSON()).toEqual({ resetToken, password: "Replacement#2026" });
      submitted = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ passwordReset: true }) });
    });
    await page.goto(`/login?tenant=iglo-architects&reset=${resetToken}`);
    await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Work email" })).toHaveCount(0);
    await page.getByRole("textbox", { name: "New password", exact: true }).fill("Replacement#2026");
    await page.getByRole("textbox", { name: "Confirm password" }).fill("Different#2026");
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(page.getByText("Passwords do not match.")).toBeVisible();
    expect(submitted).toBe(false);
    await page.getByRole("textbox", { name: "Confirm password" }).fill("Replacement#2026");
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(page).toHaveURL(/\/login\?tenant=iglo-architects&reason=password-reset$/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Password", exact: true })).toHaveValue("");
    expect(submitted).toBe(true);
  });

  test("keeps an expired recovery link visible with a useful error", async ({ page }) => {
    await page.route("**/api/auth/reset-password", route => route.fulfill({
      status: 410, contentType: "application/json", body: JSON.stringify({ message: "Password reset token is invalid or expired" }),
    }));
    await page.goto("/login?reset=expired-recovery-token-with-sufficient-length");
    await page.getByRole("textbox", { name: "New password", exact: true }).fill("Replacement#2026");
    await page.getByRole("textbox", { name: "Confirm password" }).fill("Replacement#2026");
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(page.getByText("Password reset token is invalid or expired")).toBeVisible();
    await expect(page.getByRole("button", { name: "Back to sign in" })).toBeVisible();
  });

  test("serves the Woddy favicon without authentication", async ({ page, request }, testInfo) => {
    await page.goto("/login");
    const icon = page.locator('head link[rel="icon"]');
    await expect(icon).toHaveAttribute("href", /\/icon\?/);
    await expect(icon).toHaveAttribute("type", "image/png");
    await expect(icon).toHaveAttribute("sizes", "64x64");
    const response = await request.get((await icon.getAttribute("href"))!);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");
    const image = await response.body();
    expect(image.readUInt32BE(16)).toBe(64);
    expect(image.readUInt32BE(20)).toBe(64);
    expect(image.length).toBeLessThan(20000);
    await testInfo.attach("Woddy favicon", { body: image, contentType: "image/png" });
  });

  for (const workspaceTheme of ["light", "dark"] as const) {
    test(`uses Workspace colors and readable fields after a ${workspaceTheme} workspace`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.emulateMedia({ reducedMotion: "reduce", colorScheme: workspaceTheme });
      await page.goto("/login");
      // Interact before applying the saved theme so initial hydration has finished.
      await page.getByRole("button", { name: "Show password" }).click();
      await page.getByRole("button", { name: "Hide password" }).click();
      // Client-side navigation from Workspace preserves the document's theme.
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, workspaceTheme);

      const email = page.getByRole("textbox", { name: "Work email" });
      const password = page.getByRole("textbox", { name: "Password" });
      const submit = page.getByRole("button", { name: "Sign in", exact: true });
      await expect(email).toHaveCSS("color", "rgb(47, 35, 45)");
      await expect(password).toHaveCSS("color", "rgb(47, 35, 45)");
      for (const field of [email, password]) {
        await expect(field).toHaveCSS("-webkit-text-fill-color", "rgb(47, 35, 45)");
        await expect(field).toHaveCSS("color-scheme", "light");
        await expect(field).toHaveCSS("caret-color", "rgb(105, 79, 122)");
      }
      await expect(submit).toHaveCSS("color", "rgb(47, 35, 45)");
      await expect(page.getByRole("button", { name: "Forgot password?" })).toHaveCSS("color", "rgb(105, 79, 122)");
      await expect(submit).toHaveCSS("background-image", "linear-gradient(120deg, rgb(214, 185, 243) 0%, rgb(228, 162, 188) 48%, rgb(243, 155, 84) 100%)");
      const backdrop = await page.getByRole("main").evaluate((main) => getComputedStyle(main).getPropertyValue("--login-backdrop"));
      expect(backdrop).toMatch(/#fff(?:fff)? 44%/);
      expect(backdrop).toContain("#d6b9f3");
      expect(backdrop).toContain("#f39b54");
      await expect(page.locator('[aria-label="Wodana"]:visible img')).toHaveAttribute("src", /wodana-logo-v4\.png/);

      await email.focus();
      await expect(page.locator(".wd-input-group").first()).toHaveCSS("border-color", "rgb(105, 79, 122)");
      await expect(page.locator(".wd-input-group").first()).not.toHaveCSS("box-shadow", "none");
      await page.keyboard.press("Tab");
      await expect(password).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "Show password" })).toBeFocused();
      await expect(page.getByRole("button", { name: "Show password" })).toHaveCSS("outline-color", "rgb(105, 79, 122)");
      await page.keyboard.press("Enter");
      await expect(password).toHaveAttribute("type", "text");
      await expect(password).toHaveCSS("-webkit-text-fill-color", "rgb(47, 35, 45)");
      await page.keyboard.press("Enter");
      await expect(password).toHaveAttribute("type", "password");

      const initialEmail = await email.inputValue();
      await email.fill("");
      const placeholder = await email.evaluate((input) => {
        const style = getComputedStyle(input, "::placeholder");
        return { color: style.color, fill: style.getPropertyValue("-webkit-text-fill-color"), opacity: style.opacity };
      });
      expect(placeholder.fill).toBe(placeholder.color);
      expect(placeholder.opacity).toBe("1");
      await email.fill(initialEmail);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await page.getByRole("heading", { name: "Welcome back" }).click();
      await page.screenshot({ path: testInfo.outputPath(`login-${workspaceTheme}.png`), fullPage: true });

      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(async () => {
        const result = await (window as unknown as { axe: typeof axe }).axe.run(document);
        return result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }));
      });
      expect(violations).toEqual([]);

      await page.goto("/login?invitation=ui-theme-check");
      await page.getByRole("button", { name: "Show password" }).click();
      await page.getByRole("button", { name: "Hide password" }).click();
      await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, workspaceTheme);
      await expect(page.getByRole("button", { name: "Activate invitation" })).toHaveCSS("color", "rgb(47, 35, 45)");
      await expect(page.getByRole("textbox", { name: "New password", exact: false })).toHaveCSS("color", "rgb(47, 35, 45)");
      await expect(page.getByRole("textbox", { name: "New password", exact: false })).toHaveCSS("-webkit-text-fill-color", "rgb(47, 35, 45)");
      await expect(page.getByRole("textbox", { name: "Confirm password", exact: false })).toHaveCSS("-webkit-text-fill-color", "rgb(47, 35, 45)");
      await page.getByRole("button", { name: "Activate invitation" }).click();
      await expect(page.getByText("Use 10+ characters with uppercase, lowercase, a number, and a symbol.")).toBeVisible();
      await expect(page.locator(".wd-field-error").first()).toHaveCSS("color", "rgb(168, 63, 70)");
      expect(errors).toEqual([]);
    });
  }

  test("creates a browser session and enters the workspace", async ({ page }, testInfo) => {
    await page.route("**/api/auth/login", async (route) => {
      const payload = route.request().postDataJSON();
      expect(payload).toMatchObject({
        email: "admin@igloarchitects.com",
        password: "IgloDemo#2026",
        tenantSlug: "iglo-architects",
      });
      // Exercise the local seed login and preserve its session cookies. A fabricated
      // success response cannot open Workspace when the server enforces auth.
      await route.continue();
    });
    await page.goto("/login");

    await expect(page.locator('[aria-label="Wodana"]:visible')).toBeVisible();
    await expect(page.locator('[aria-label="Wodana and Iglo Architects"]:visible')).toBeVisible();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Google Workspace/ })).toHaveCount(0);

    const email = page.getByRole("textbox", { name: "Work email" });
    const password = page.getByRole("textbox", { name: "Password" });
    await expect(email).toHaveValue("admin@igloarchitects.com");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(password).toHaveAttribute("type", "text");
    const loginResponse = page.waitForResponse("**/api/auth/login");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    expect((await loginResponse).ok()).toBe(true);
    await expect(page).toHaveURL(/\/workspace$/, { timeout: 15_000 });
    await expect(page.getByRole("region", { name: "Org profile workspace" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(page.getByRole("dialog", { name: "Mobile workspace navigation" })).toBeVisible();
    }
    const navigation = testInfo.project.name === "mobile"
      ? page.getByRole("dialog", { name: "Mobile workspace navigation" })
      : page.getByRole("complementary", { name: "Workspace navigation" });
    await expect(navigation.getByRole("button", { name: "Switch workspace. Current: Iglo Architects" })).toBeVisible();
  });

  test("presents the Wodana operating-workspace story", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "The brand story is desktop-only");
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Hey, hello!" })).toBeVisible();
    await expect(page.getByText("One workspace for the whole customer journey.")).toBeVisible();
  });

  test("validates incomplete sign-in details without leaving the page", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("textbox", { name: "Work email" }).fill("");
    await page.getByRole("textbox", { name: "Password" }).fill("");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Enter a valid work email address.")).toBeVisible();
    await expect(page.getByText("Password must contain at least 8 characters.")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("fits product breakpoints without page scrolling", async ({ page }) => {
    for (const viewport of [
      { width: 320, height: 844 },
      { width: 390, height: 844 },
      { width: 768, height: 900 },
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/login");
      const overflow = await page.evaluate(() => ({
        horizontal: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        vertical: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      }));
      expect(overflow.horizontal).toBeLessThanOrEqual(1);
      expect(overflow.vertical).toBeLessThanOrEqual(1);
    }
  });

  test("uses a compact product typography hierarchy", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Desktop split-screen hierarchy");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");

    const sizes = await page.evaluate(() => ({
      body: Number.parseFloat(getComputedStyle(document.body).fontSize),
      welcomeHeading: Number.parseFloat(
        getComputedStyle(document.querySelector("#welcome-heading") as HTMLElement).fontSize,
      ),
      loginHeading: Number.parseFloat(
        getComputedStyle(document.querySelector("#login-heading") as HTMLElement).fontSize,
      ),
      workEmailLabel: Number.parseFloat(
        getComputedStyle(document.querySelector(".wd-field-label") as HTMLElement).fontSize,
      ),
    }));

    expect(sizes.body).toBe(14);
    expect(sizes.loginHeading).toBeGreaterThanOrEqual(27);
    expect(sizes.loginHeading).toBeLessThanOrEqual(30);
    expect(sizes.welcomeHeading).toBeGreaterThanOrEqual(49);
    expect(sizes.welcomeHeading).toBeLessThanOrEqual(93);
    expect(sizes.workEmailLabel).toBe(12);
  });

  test("has no automatic accessibility violations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/login");
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => {
      const runner = (window as unknown as { axe: typeof axe }).axe;
      const result = await runner.run(document, {
        rules: { "color-contrast": { enabled: true } },
      });
      return result.violations.map((violation) => ({
        id: violation.id,
        targets: violation.nodes.map((node) => node.target),
      }));
    });
    expect(violations).toEqual([]);
  });
});
