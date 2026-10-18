import { expect, test } from "@playwright/test";
import axe from "axe-core";
import { workspaceScreens } from "../components/workspace/workspace-navigation";
import { companyProfileFixture } from "../lib/workspace/company-profile";

test.describe("workspace shell", () => {
  test("keeps every planned destination available", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Route inventory is viewport independent");
    await page.goto("/workspace/company");
    await page.context().addCookies([{ name: "wodana_access", value: "local-e2e-fixture", url: new URL(page.url()).origin }]);
    const directlyAddressableScreens = workspaceScreens.filter((screen) => !screen.href.startsWith("/workspace/projects/") || screen.href === "/workspace/projects");
    for (const screen of directlyAddressableScreens) {
      const response = await page.goto(screen.href);
      expect(response?.ok()).toBe(true);
      await expect(page).not.toHaveURL(/\/login/);
      const main = page.getByRole("main");
      await expect(main).toBeVisible();
      await expect(main).not.toBeEmpty();
    }
  });

  test("renders the workspace's active business record", async ({ page }) => {
    await page.goto("/workspace/legal-entities");

    const records = page.getByRole("region", { name: "Business records" });
    await expect(records.getByText("Iglo Architects", { exact: true })).toBeVisible();
    await expect(records.getByText("IGLO · Iglo Architects LLC", { exact: true })).toBeVisible();
  });

  test("moves between Workspace and CRM without losing navigation context", async ({ page }, testInfo) => {
    await page.goto("/workspace/company");
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Open navigation" }).click();
    }
    await expect(page.getByRole("link", { name: "Company profile" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("region", { name: "Company profile" })).toBeVisible();
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Close navigation" }).click();
      await page.getByRole("button", { name: "Switch module. Current: Workspace" }).click();
      await page.getByRole("dialog", { name: "Choose module" }).getByRole("link", { name: /^CRM/ }).click();
    } else {
      await page.getByRole("navigation", { name: "Modules" }).getByRole("link", { name: "CRM", exact: true }).click();
    }
    await expect(page).toHaveURL(/\/workspace\/crm$/);
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Open navigation" }).click();
    }
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Enquiries", exact: true }).click();
    await expect(page).toHaveURL(/\/workspace\/crm\/leads$/);
    if (testInfo.project.name === "desktop") {
      const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
      await expect(breadcrumb.getByText("Enquiries", { exact: true })).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Enquiries", exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
    } else {
      await expect(page.getByRole("heading", { name: "Enquiries" })).toBeVisible();
    }
    await expect(page.getByRole("region", { name: "Enquiries workspace" })).toBeVisible();
  });

  test("searches simplified CRM navigation without losing keyboard access", async ({ page }, testInfo) => {
    await page.goto("/workspace/crm");
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Open navigation" }).click();
    }
    await expect(page.getByRole("link", { name: "Sequences" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "CRM reports" })).toHaveCount(0);

    await page.keyboard.press("Meta+k");
    const search = page.getByRole("searchbox", { name: "Search navigation" });
    await expect(search).toBeFocused();
    await search.fill("follow");
    const mainNavigation = page.getByRole("navigation", { name: "Main navigation" });
    await expect(mainNavigation.getByRole("link", { name: "Follow-ups", exact: true })).toBeVisible();
    await expect(mainNavigation.getByRole("link", { name: "Today", exact: true })).toHaveCount(0);
    await search.press("Escape");
    await expect(mainNavigation.getByRole("link", { name: "Today", exact: true })).toBeVisible();
  });

  test("uses a slim fixed sidebar without a floating collapse control", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Desktop sidebar geometry");
    await page.goto("/workspace/crm");
    await expect(page.getByRole("button", { name: /Collapse sidebar/ })).toHaveCount(0);

    const geometry = await page.evaluate(() => {
      const sidebar = document.querySelector('aside[aria-label="Workspace navigation"]');
      const content = document.querySelector("main");
      return {
        contentStart: content?.getBoundingClientRect().left ?? 0,
        sidebarEnd: sidebar?.getBoundingClientRect().right ?? 0,
        sidebarWidth: sidebar?.getBoundingClientRect().width ?? 0,
      };
    });
    expect(geometry.sidebarWidth).toBeGreaterThanOrEqual(240);
    expect(geometry.sidebarWidth).toBeLessThanOrEqual(248);
    expect(geometry.contentStart - geometry.sidebarEnd).toBeLessThanOrEqual(1);
  });

  test("keeps module tabs and the workspace menu outside the desktop sidebar", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Desktop popover placement");
    await page.goto("/workspace/company");
    const sidebar = page.getByRole("complementary", { name: "Workspace navigation" });
    const sidebarBox = await sidebar.boundingBox();
    expect(sidebarBox).not.toBeNull();

    const moduleTabs = page.getByRole("navigation", { name: "Modules" });
    await expect(moduleTabs.getByRole("link", { name: "CRM", exact: true })).toBeVisible();
    const moduleTabsBox = await moduleTabs.boundingBox();
    expect(moduleTabsBox?.x ?? 0).toBeGreaterThanOrEqual(
      (sidebarBox?.x ?? 0) + (sidebarBox?.width ?? 0),
    );

    await page
      .getByRole("button", { name: "Switch workspace. Current: Iglo Architects" })
      .click();
    const workspaceMenu = page.getByRole("dialog", { name: "Choose workspace" });
    await expect(workspaceMenu).toBeVisible();
    const workspaceMenuBox = await workspaceMenu.boundingBox();
    expect(workspaceMenuBox?.x ?? 0).toBeGreaterThanOrEqual(
      (sidebarBox?.x ?? 0) + (sidebarBox?.width ?? 0),
    );
  });

  test("uses a focus-managed drawer on mobile", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile drawer behavior");
    await page.goto("/workspace/crm");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("dialog", { name: "Mobile workspace navigation" })).toBeVisible();
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Enquiries", exact: true }).click();
    await expect(page).toHaveURL(/\/workspace\/crm\/leads$/);
    await expect(page.getByRole("dialog", { name: "Mobile workspace navigation" })).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("has no automatic accessibility violations", async ({ page }, testInfo) => {
    await page.goto("/workspace/company");
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Open navigation" }).click();
    }
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

  test("edits the company profile through the versioned save boundary", async ({ page }) => {
    let requestBody: Record<string, unknown> | undefined;
    await page.route("**/api/workspace/company-profile", async (route) => {
      requestBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        body: JSON.stringify({
          workspace: {
            ...companyProfileFixture.workspace,
            name: "Iglo Architecture",
            slug: "iglo-architecture",
            version: 2,
          },
          legalEntity: {
            ...companyProfileFixture.legalEntities[0],
            displayName: "Iglo Architecture",
            version: 2,
          },
        }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.goto("/workspace/company");
    await page.getByRole("button", { name: "Edit profile" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit profile" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox", { name: "Company name", exact: true }).fill("Iglo Architecture");
    await expect(dialog.getByRole("textbox", { name: "Registered company name" })).toBeVisible();
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText("Company profile saved.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Iglo Architecture" })).toBeVisible();
    expect(requestBody).toMatchObject({
      workspaceId: companyProfileFixture.workspace.id,
      workspaceVersion: 1,
      legalEntityVersion: 1,
      name: "Iglo Architecture",
      registeredName: companyProfileFixture.legalEntities[0].registeredName,
    });
  });

  test("matches the approved company profile workspace", async ({ page }) => {
    await page.goto("/workspace/company");
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await expect(page).toHaveScreenshot("workspace-shell.png", {
      animations: "disabled",
      caret: "initial",
      maxDiffPixelRatio: 0.005,
    });
  });
});
