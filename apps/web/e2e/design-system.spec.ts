import { expect, test } from "@playwright/test";
import axe from "axe-core";

test.describe("design system reference", () => {
  test("loads and operates without runtime or hydration errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/design-system#data");
    await page.getByRole("button", { name: /All projects.*Table view/ }).click();
    await page.getByRole("option", { name: "My projects", exact: true }).click();
    await page.getByRole("button", { name: "Palm Villa" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Close inspector" }).click();
    const devToolbar = page.locator("nextjs-portal");
    const devToolbarText = await devToolbar.evaluate((portal) => portal.shadowRoot?.textContent ?? "");
    expect(devToolbarText).not.toContain("1 Issue");
    expect(errors).toEqual([]);
  });
  test("hydrates on the loopback preview origin", async ({ page }) => {
    await page.goto("http://127.0.0.1:3100/design-system");
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.getByRole("button", { name: "Add page comment" }).click();
    await expect(page.locator(".wd-comment-canvas")).toBeVisible();
    await page.getByRole("button", { name: "Exit comment mode" }).click();
  });
  test("sidebar and global display controls remain interactive", async ({ page }, testInfo) => {
    await page.goto("/design-system");
    if (testInfo.project.name === "desktop") {
      await page.getByRole("button", { name: "Collapse sidebar" }).click();
      await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
      await page.waitForTimeout(240);
      const positions = await page.evaluate(() => {
        const toggle = document.querySelector('[aria-label="Expand sidebar"]')?.getBoundingClientRect();
        const title = document.querySelector('[class*="topbarTitle"] strong')?.getBoundingClientRect();
        return { toggleRight: toggle?.right ?? 0, titleLeft: title?.left ?? 0 };
      });
      expect(positions.toggleRight).toBeLessThanOrEqual(positions.titleLeft);
      await page.getByRole("button", { name: "Expand sidebar" }).click();
      await expect(page.getByRole("link", { name: "Data tables" })).toBeVisible();
    } else {
      await expect(page.getByRole("button", { name: /sidebar/i })).toHaveCount(0);
    }
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await expect(page.locator(".wd-root")).toHaveAttribute("data-wd-theme", "dark");
    await page.getByRole("button", { name: "Use high contrast theme" }).click();
    await page.getByRole("button", { name: "Use light theme" }).click();
    await page.getByRole("button", { name: "Use compact density" }).click();
    await expect(page.locator(".wd-root")).toHaveAttribute("data-wd-density", "compact");
    await page.getByRole("button", { name: "Switch to RTL" }).click();
    await expect(page.locator(".wd-root")).toHaveAttribute("dir", "rtl");
  });
  test("renders without horizontal page overflow", async ({ page }) => {
    await page.goto("/design-system");
    await expect(page.getByRole("heading", { name: "Overview · September" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
  test("has no page overflow at every supported breakpoint", async ({ page }) => {
    for (const width of [320, 390, 768, 808, 1024, 1440]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await page.goto("/design-system");
      const metrics = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(metrics.scroll, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(metrics.client + 1);
    }
  });
  test("mobile data grid keeps the primary record and removes nonessential columns", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/design-system#data");
    await expect(page.locator('.wd-table [data-column="project"]').first()).toBeVisible();
    await expect(page.locator('.wd-table [data-column="status"]').first()).toBeVisible();
    await expect(page.locator('.wd-table [data-column="owner"]').first()).toBeHidden();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
  test("every table sits in the shared rounded frame and its floating controls follow dark mode", async ({ page }, testInfo) => {
    if (testInfo.project.name !== "desktop") return;
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto("/design-system#data");
    const grid = page.locator(".wd-data-grid").first();
    await expect(grid).not.toHaveAttribute("data-appearance", /.*/);
    const frame = await grid.locator(".wd-table-scroll").first().evaluate((element) => {
      const style = getComputedStyle(element);
      const header = getComputedStyle(element.querySelector("th")!);
      return { border: style.borderTopWidth, radius: style.borderTopLeftRadius, headerBackground: header.backgroundColor, surface: style.backgroundColor, sticky: header.position };
    });
    expect(frame.border).toBe("1px");
    expect(frame.radius).not.toBe("0px");
    expect(frame.headerBackground).not.toBe(frame.surface);
    expect(frame.sticky).toBe("sticky");
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await grid.getByRole("button", { name: "Filter", exact: true }).click();
    const panel = page.locator(".wd-record-panel");
    await expect(panel).toHaveAttribute("data-wd-theme", "dark");
    expect(await panel.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe("rgb(255, 255, 255)");
  });
  test("closed selects expose only the disclosure indicator", async ({ page }) => {
    await page.goto("/design-system#forms");
    const select = page.locator(".wd-select-button").first();
    await expect(select).toBeVisible();
    await expect(select.locator(".wd-select-indicator")).toHaveCount(1);
    await expect(select.locator(".wd-picker-check")).toHaveCount(0);
  });
  test("field focus plays one gradient sweep and settles to the focus border", async ({ page }) => {
    await page.goto("/design-system#forms");
    const input = page.getByRole("textbox", { name: "Full name" });
    await input.focus();
    const frame = input.locator("..");
    await expect(frame).toHaveAttribute("data-focus-within", "true");
    const activeAnimation = await frame.evaluate((element) => {
      const style = getComputedStyle(element, "::after");
      return { name: style.animationName, iterations: style.animationIterationCount };
    });
    expect(activeAnimation.name).toContain("wd-field-border-sweep");
    expect(activeAnimation.iterations).toBe("1");
    await page.waitForTimeout(650);
    const settled = await frame.evaluate((element) => ({
      borderColor: getComputedStyle(element).borderColor,
      gradientOpacity: getComputedStyle(element, "::after").opacity,
    }));
    expect(settled.gradientOpacity).toBe("0");
    expect(settled.borderColor).toBe("rgb(102, 88, 232)");

    const select = page.getByRole("button", { name: "Project type" });
    await select.click();
    const selectAnimation = await select.evaluate((element) =>
      getComputedStyle(element, "::after").animationIterationCount,
    );
    expect(selectAnimation).toBe("1");
  });
  test("uses compact navigation instead of an icon rail on tablet widths", async ({ page }) => {
    await page.setViewportSize({ width: 808, height: 900 });
    await page.goto("/design-system");
    await expect(page.getByText("wodana", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /sidebar/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Data tables" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
  test("switches RTL and opens the fixed inspector", async ({ page }) => {
    await page.goto("/design-system");
    await page.getByRole("button", { name: "Switch to RTL" }).click();
    await expect(page.locator(".wd-root")).toHaveAttribute("dir", "rtl");
    await expect(page.getByText("24 Sep 2026", { exact: true })).toHaveAttribute("dir", "ltr");
    await page.getByRole("button", { name: "Shah Residence" }).click();
    await expect(page.getByRole("dialog")).toContainText("Shah Residence");
  });
  test("saved views and column filters change the visible rows", async ({ page }) => {
    await page.goto("/design-system");
    await page.getByRole("button", { name: /All projects.*Table view/ }).click();
    await page.getByRole("option", { name: "My projects", exact: true }).click();
    await expect(page.getByRole("button", { name: "Palm Villa" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Shah Residence" })).toHaveCount(0);
    await page.getByRole("button", { name: "Filter" }).first().click();
    await page.getByRole("textbox", { name: "Contains" }).fill("missing");
    await expect(page.getByText("No records found").first()).toBeVisible();
  });
  test("component search filters the documented inventory", async ({ page }) => {
    await page.goto("/design-system");
    const search = page.getByRole("textbox", { name: "Search components" });
    if (await search.count() === 0) {
      await expect(page.getByRole("navigation", { name: "Design system sections" })).toBeVisible();
      return;
    }
    await search.fill("data");
    await expect(page.getByRole("link", { name: "Data tables" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Foundations" })).toHaveCount(0);
    await search.fill("not-a-component");
    await expect(page.getByRole("navigation", { name: "Design system sections" }).getByRole("link")).toHaveCount(0);
    await search.fill("");
    await expect(page.getByRole("link", { name: "Foundations" })).toBeVisible();
  });
  test("popover dismissal restores focus to its trigger", async ({ page }) => {
    await page.goto("/design-system");
    const filter = page.getByRole("button", { name: "Filter" }).first();
    await filter.click();
    await expect(page.getByRole("dialog", { name: "Filter records" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Filter records" })).toHaveCount(0);
    await expect(filter).toBeFocused();
  });
  test("has no automatic accessibility violations in every visual mode", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/design-system");
    await page.addScriptTag({ content: axe.source });
    const audit = async (label: string) => {
      await page.waitForTimeout(300);
      const violations = await page.evaluate(async () => {
        const runner = (window as unknown as { axe: typeof axe }).axe;
        const result = await runner.run(document, { rules: { "color-contrast": { enabled: true } } });
        return result.violations.map((violation) => ({ id: violation.id, impact: violation.impact, targets: violation.nodes.map((node) => ({ target: node.target, html: node.html })) }));
      });
      expect(violations, label).toEqual([]);
    };
    await audit("light LTR");
    await page.getByRole("button", { name: "Use dark theme" }).click();
    await audit("dark LTR");
    await page.getByRole("button", { name: "Use high contrast theme" }).click();
    await audit("high contrast LTR");
    await page.getByRole("button", { name: "Switch to RTL" }).click();
    await audit("high contrast RTL");
  });
  test("point comment mode opens a composer at the clicked position", async ({ page }) => {
    await page.goto("/design-system");
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.getByRole("button", { name: "Add page comment" }).click();
    await page.locator(".wd-comment-canvas").click({ position: { x: 180, y: 180 } });
    await page.getByRole("textbox", { name: "Comment" }).fill("Verify this component state");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await page.getByRole("button", { name: /Open comment 1/ }).click();
    await page.getByRole("textbox", { name: "Reply" }).fill("Verified in QC");
    await page.getByRole("button", { name: "Reply", exact: true }).click();
    await expect(page.getByText("Verified in QC", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Resolve", exact: true }).click();
    await expect(page.getByRole("button", { name: "Reopen", exact: true })).toBeVisible();
  });
  test("showcase actions provide feedback and advance workflow", async ({ page }) => {
    await page.goto("/design-system");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByText("Changes saved", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("Drawings approved", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Continue to Purchase order", exact: true }).click();
    await expect(page.getByRole("button", { name: "Continue to Receive", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Kitchen joinery Rev 04/ }).click();
    await expect(page.getByText("Document selected", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "AI review", exact: true }).click();
    await page.getByRole("button", { name: "91% confidence", exact: true }).click();
    await expect(page.getByText("Why Wodana suggested this", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(page.getByText("AI review accepted", { exact: true })).toBeVisible();
  });
  test("create project modal updates the table", async ({ page }) => {
    await page.goto("/design-system#data");
    await page.getByRole("button", { name: "Create project" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Project name" }).fill("QC Studio Apartment");
    await dialog.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByRole("button", { name: /QC Studio Apartment/ })).toBeVisible();
    await expect(page.getByText("Project created", { exact: true })).toBeVisible();
  });
  test("workflow stage labels never overlap", async ({ page }) => {
    await page.goto("/design-system#workflow");
    const boxes = await page.locator(".wd-stage-tracker").first().locator("li").evaluateAll((stages) => stages.map((stage) => {
      const box = stage.getBoundingClientRect();
      return { left: box.left, right: box.right };
    }));
    boxes.slice(1).forEach((box, index) => expect(box.left).toBeGreaterThanOrEqual(boxes[index].right - 1));
  });
  test("data grid matches its approved visual baseline", async ({ page }) => {
    await page.goto("/design-system#data");
    const section = page.locator("#data");
    await expect(section).toBeVisible();
    await page.waitForTimeout(500);
    const devToolbarText = await page.locator("nextjs-portal").evaluate((portal) => portal.shadowRoot?.textContent ?? "");
    expect(devToolbarText).not.toContain("1 Issue");
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await expect(section).toHaveScreenshot("data-grid.png", { animations: "disabled", maxDiffPixelRatio: 0.005 });
  });
});
