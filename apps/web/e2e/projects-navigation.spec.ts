import { expect, test } from "@playwright/test";

test("project table opens scoped sidebar sections and returns to the list", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const session = await page.request.post("/api/auth/login", { data: { email: "admin@igloarchitects.com", password: "IgloDemo#2026", tenantSlug: "iglo-architects" } });
  expect(session.ok()).toBe(true);
  await page.goto("/workspace/projects");
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(0);
  await page.getByRole("link", { name: "Open Jumeirah villa interiors" }).click();
  await expect(page).toHaveURL("/workspace/projects/demo/overview");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  const mobile = testInfo.project.name === "mobile";
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await page.goto("/workspace/projects/demo/installation");
  await expect(page).toHaveURL("/workspace/projects/demo/site-work");
  await expect(page.getByRole("heading", { level: 1, name: "Execution" })).toBeVisible();
  for (const [label, section] of [["Scope & Design", "documents"], ["BOQ", "boq"], ["Procurement", "procurement"], ["Schedules", "plan-teams"], ["Execution", "site-work"], ["Handover", "handover"], ["Budget", "commercial"], ["Dashboard", "overview"]]) {
    if (mobile) await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(nav.getByRole("link")).toHaveCount(8);
    await nav.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(`/workspace/projects/demo/${section}`);
    await expect(page.getByRole("heading", { level: 1, name: label, exact: true })).toBeVisible();
    await expect(page.getByRole("banner").getByText("Jumeirah villa interiors", { exact: true })).toBeVisible();
    if (!mobile) await expect(nav.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    if (section === "plan-teams") await expect(page.getByRole("region", { name: "Project task timeline" })).toBeVisible();
    else await expect(page.getByRole("list", { name: `${label} flow` })).toBeVisible();
    if (section === "commercial") {
      const commercialTabs = page.getByRole("navigation", { name: "Commercial sections" });
      await commercialTabs.getByRole("link", { name: "Change requests", exact: true }).click();
      await expect(page).toHaveURL("/workspace/projects/demo/commercial?view=change-requests");
      await expect(page.getByRole("heading", { level: 2, name: "Change requests", exact: true })).toBeVisible();
      await page.reload();
      await expect(commercialTabs.getByRole("link", { name: "Change requests", exact: true })).toHaveAttribute("aria-current", "page");
      await page.screenshot({ animations: "disabled", path: testInfo.outputPath("project-change-requests.png") });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await commercialTabs.getByRole("link", { name: "Summary", exact: true }).click();
      await expect(page).toHaveURL("/workspace/projects/demo/commercial");
      await expect(page.getByRole("list", { name: "Budget flow" })).toBeVisible();
    }
  }
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  if (mobile) await page.getByRole("button", { name: "Open navigation" }).click();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("project-sidebar.png") });
  if (mobile) await page.getByRole("button", { name: "Close navigation" }).click();
  await page.getByRole("link", { name: "All projects", exact: true }).click();
  await expect(page).toHaveURL("/workspace/projects");
  await expect(page.getByRole("link", { name: "Open Jumeirah villa interiors" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  const backToPreProjects = page.getByRole("link", { name: "Back to Pre-execution", exact: true });
  await expect(backToPreProjects).toBeVisible();
  const backBox = await backToPreProjects.boundingBox();
  const tableBox = await page.getByRole("table", { name: "Projects" }).boundingBox();
  expect(backBox!.y + backBox!.height).toBeLessThan(tableBox!.y);
  expect(backBox!.x).toBeLessThanOrEqual(tableBox!.x);
  await backToPreProjects.click();
  await expect(page).toHaveURL("/workspace/pre-projects");
  await expect(page.getByRole("heading", { level: 1, name: "Qualified leads", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("module switcher connects matching tables and empty states stay centered", async ({ page }, testInfo) => {
  const session = await page.request.post("/api/auth/login", { data: { email: "admin@igloarchitects.com", password: "IgloDemo#2026", tenantSlug: "iglo-architects" } });
  expect(session.ok()).toBe(true);
  await page.goto("/workspace/pre-projects");
  const preTable = page.getByRole("table");
  await expect(preTable).toBeVisible();
  if (testInfo.project.name === "mobile") await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Switch module. Current: Pre-execution" }).click();
  await page.getByRole("dialog", { name: "Choose module" }).getByRole("link", { name: /Projects.*Delivery/ }).click();
  await expect(page).toHaveURL("/workspace/projects");
  const table = page.getByRole("table", { name: "Projects" });
  await expect(table).toBeVisible();
  await expect(table).toHaveAttribute("data-record-table", "");
  const search = page.getByRole("textbox", { name: "Search projects", exact: true });
  await search.fill("does not exist");
  await search.press("Enter");
  await expect(page.getByRole("heading", { name: "No matching projects", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  for (const theme of ["light", "dark"]) {
    const toggle = page.getByRole("button", { name: `Use ${theme} mode` });
    if (await toggle.count()) await toggle.click();
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`projects-table-${theme}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
  await page.getByRole("group", { name: "Project status" }).getByRole("button", { name: "Completed", exact: true }).click();
  for (const [module, emptyTitle] of [["projects", "No matching projects"], ["pre-projects", "No matching qualified leads"]]) {
    if (module === "pre-projects") {
      await page.getByRole("link", { name: "Back to Pre-execution", exact: true }).click();
      await expect(page).toHaveURL("/workspace/pre-projects");
      const preSearch = page.getByRole("searchbox", { name: "Search qualified leads", exact: true });
      await preSearch.fill(`__no_matching_pre_project_${testInfo.testId}`);
      await preSearch.press("Enter");
    }
    await expect(page.getByText(emptyTitle, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: module === "projects" ? "Clear filters" : "Clear search", exact: true }).last()).toBeVisible();
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`${module}-empty-centered.png`) });
    await page.getByRole("button", { name: module === "projects" ? "Clear filters" : "Clear search", exact: true }).last().click();
    await expect(page.getByRole("table")).toBeVisible();
  }
});
