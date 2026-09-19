import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/workspace/projects");
  await page.context().addCookies([{ name: "wodana_access", value: "local-e2e-fixture", url: new URL(page.url()).origin }]);
  await expect(page.getByRole("table", { name: "Projects" })).toBeVisible();
}

test("project table opens the backend-guided workspace and its sections", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  await page.goto("/workspace/projects");
  await expect(page.getByRole("table", { name: "Projects" })).toBeVisible();
  await page.getByRole("button", { name: "Jumeirah villa interiors" }).click();
  await expect(page).toHaveURL("/workspace/projects/demo/overview");
  await expect(page.getByRole("heading", { level: 1, name: "Jumeirah villa interiors" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Next actions/ })).toBeVisible();

  const mobile = testInfo.project.name === "mobile";
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  for (const [name, section] of [
    ["Scope & Design", "documents"], ["BOQ", "boq"], ["Material planning", "material-planning"],
    ["Procurement", "procurement"], ["Schedules", "plan-teams"], ["Production", "production"],
    ["Onsite execution", "site-work"], ["Daily progress", "daily-progress"],
    ["Snagging & warranty", "snagging"], ["Handover", "handover"],
    ["Budget", "commercial"], ["Dashboard", "overview"],
  ] as const) {
    if (mobile) await page.getByRole("button", { name: "Open navigation" }).click();
    await navigation.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(`/workspace/projects/demo/${section}`);
    await expect(page.getByRole("heading", { level: 1, name: "Jumeirah villa interiors" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }

  await page.getByRole("link", { name: "All projects" }).click();
  await expect(page).toHaveURL("/workspace/projects");
  await expect(page.getByRole("table", { name: "Projects" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("module switcher opens Projects and shared table search has a real empty state", async ({ page }, testInfo) => {
  await signIn(page);
  await page.goto("/workspace/pre-projects");
  await expect(page.getByRole("table")).toBeVisible();
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "Switch module. Current: Pre-execution" }).click();
    await page.getByRole("dialog", { name: "Choose module" }).getByRole("link", { name: /Projects/ }).click();
  } else {
    const modules = page.getByRole("navigation", { name: "Modules" });
    await expect(modules.getByRole("link", { name: "Pre-execution" })).toHaveAttribute("aria-current", "page");
    await modules.getByRole("link", { name: "Projects" }).click();
  }
  await expect(page).toHaveURL("/workspace/projects");
  await expect(page.getByRole("table", { name: "Projects" })).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search projects" });
  await search.fill("__no_matching_project__");
  await expect(page.getByText("No matching projects", { exact: true })).toBeVisible();
  await search.fill("");
  await expect(page.getByRole("button", { name: "Jumeirah villa interiors" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
