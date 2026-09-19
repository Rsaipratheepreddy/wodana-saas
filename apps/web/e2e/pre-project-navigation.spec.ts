import { expect, test, type Page } from "@playwright/test";
const root = "/workspace/pre-projects";
async function signIn(page: Page) {
  // This suite exercises the local E2E workspace fixture, not the MFA login flow.
  // The catalog page checks for a cookie even when E2E_AUTH_BYPASS is enabled.
  await page.goto(root);
  await page.context().addCookies([{ name: "wodana_access", value: "local-e2e-fixture", url: new URL(page.url()).origin }]);
  await expect(page.getByRole("heading", { level: 1, name: "Qualified leads", exact: true })).toBeVisible();
}
test("selector to case workspace keeps context, state and mobile navigation", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  const mobile = testInfo.project.name === "mobile";
  if (mobile) await page.getByRole("button", { name: "Open navigation" }).click();
  const moduleNavigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(moduleNavigation.getByRole("link")).toHaveCount(4);
  await expect(moduleNavigation.getByRole("link", { name: "Pre-execution cases", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(moduleNavigation.getByRole("link", { name: "Master Data", exact: true })).toHaveAttribute("href", `${root}/master-data`);
  await expect(moduleNavigation.getByRole("link", { name: "Supplier Offers", exact: true })).toHaveAttribute("href", `${root}/supplier-offers`);
  await expect(moduleNavigation.getByRole("link", { name: "Quotation Templates", exact: true })).toHaveAttribute("href", `${root}/quotation-templates`);
  if (mobile) await page.getByRole("button", { name: "Close navigation" }).click();
  if (mobile) {
    await page.getByRole("button", { name: "Switch module. Current: Pre-execution" }).click();
    await expect(page.getByRole("dialog", { name: "Choose module" })).toBeVisible();
    await page.keyboard.press("Escape");
  } else {
    await expect(page.getByRole("navigation", { name: "Modules" }).getByRole("link", { name: "Pre-execution", exact: true })).toHaveAttribute("aria-current", "page");
  }
  await expect(page.getByRole("group", { name: "Pre-execution view" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cards", exact: true })).toHaveCount(0);
  await expect(page.getByRole("table")).toBeVisible();
  const header = await page.getByRole("banner").boundingBox();
  const main = await page.getByRole("main").boundingBox();
  expect(header?.x).toBe(main?.x);
  expect(header?.width).toBe(main?.width);
  const panel = await page.getByRole("main").locator("section > div").first().boundingBox();
  expect(panel!.width).toBeLessThanOrEqual(1120);
  expect(Math.abs(panel!.x - (main!.x + (main!.width - panel!.width) / 2))).toBeLessThanOrEqual(1);
  await expect(page.getByRole("group", { name: "Pre-execution status" })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search qualified leads", exact: true }).fill("no-matching-qualified-lead-qa");
  await page.getByRole("searchbox", { name: "Search qualified leads", exact: true }).press("Enter");
  await expect(page.getByText("No matching qualified leads", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).last().click();
  await expect(page).toHaveURL(root);
  const first = page.getByRole("table").locator("tbody tr").first().getByRole("link", { name: /^Open / });
  const title = (await first.getAttribute("aria-label"))!.replace(/^Open /, "");
  await page.getByRole("searchbox", { name: "Search qualified leads", exact: true }).fill(title);
  await page.getByRole("searchbox", { name: "Search qualified leads", exact: true }).press("Enter");
  await expect(page).toHaveURL(/search=/);
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(1);
  const returnState = Object.fromEntries(new URL(page.url()).searchParams);
  await page.screenshot({ path: testInfo.outputPath("pre-project-selector-table.png") });
  await page.getByRole("table").getByRole("link", { name: `Open ${title}`, exact: true }).click();
  await expect(page).toHaveURL(/\/cases\/[\da-f-]+\/overview/);
  await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
  if (mobile) {
    await expect(page.getByRole("banner").getByRole("link", { name: "Qualified leads" })).toBeVisible();
  } else {
    await expect(page.getByRole("banner").getByText(title, { exact: true })).toBeVisible();
  }
  const casePath = new URL(page.url()).pathname.replace("/overview", "");
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  const destinations = [
    ["Case overview", "overview"], ["Requirements", "requirements"], ["Client inspirations", "inspiration"], ["Design", "designs"],
    ["Scope confirmation", "definition"],
    ["Quotations", "quotations"], ["Agreement & payments", "contracts"], ["Change requests", "variations"],
    ["Approvals & release", "execution-release"], ["Client portal", "client-portal"],
  ];
  for (const [label, section] of destinations) {
    if (mobile) await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(navigation.getByRole("link")).toHaveCount(10);
    await expect(navigation.getByRole("link", { name: "Master Data", exact: true })).toHaveCount(0);
    const link = navigation.getByRole("link", { name: label, exact: true });
    expect(await link.getAttribute("href")).toContain(casePath + "/" + section + "?search=");
    await link.click();
    await expect(page.getByRole("heading", { level: 1, name: section === "overview" ? title : label, exact: true })).toBeVisible();
    if (section === "overview") {
      await expect(page.getByRole("list", { name: "Pre-execution preparation path" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Pre-execution readiness timeline" })).toContainText("From accepted scope to execution release");
    }
    if (section === "requirements") {
      const coverage = page.getByRole("region", { name: "Discovery coverage" });
      await expect(coverage).toContainText("Rooms covered0 of 3");
      await expect(coverage).toContainText("Rooms without requirements: Reception, Meeting room, Workplace");
      await expect(coverage).toContainText("Client draftsClear");
    }
    if (section === "definition") {
      await expect(page.getByText("Not published", { exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Scope to finish" })).toContainText("Add and review project requirements");
      await expect(page.getByRole("region", { name: "Quotation readiness" })).toContainText("Add a scope item");
      await expect(page.getByText("Scope confirmation unavailable")).toHaveCount(0);
    }
    if (!mobile) await expect(navigation.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
  }
  await page.getByRole("link", { name: "Qualified leads" }).click();
  await expect(page).toHaveURL((url) => url.pathname === root && Object.entries(returnState).every(([key, value]) => url.searchParams.get(key) === value));
  await expect(page.getByRole("searchbox", { name: "Search qualified leads", exact: true })).toHaveValue(title);
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).last().click();
  await expect(page).toHaveURL(root);
  for (const theme of ["light", "dark"]) {
    const toggle = page.getByRole("button", { name: `Use ${theme} mode` });
    if (await toggle.count()) await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`pre-project-selector-${theme}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
  await page.evaluate(() => { document.documentElement.dir = "rtl"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
test("legacy card links still render the table and round row actions open cases", async ({ page }) => {
  await signIn(page);
  await page.goto(`${root}?view=cards`);
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cards", exact: true })).toHaveCount(0);
  await page.getByRole("table").getByRole("link", { name: /^Open / }).first().click();
  await expect(page).toHaveURL(/\/cases\/[\da-f-]+\/overview$/);
  await expect(page.getByRole("heading", { name: "Villa interiors", exact: true })).toBeVisible();
});
test("open existing case returns to the qualified list", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("button", { name: "Start pre-execution", exact: true })).toHaveCount(0);
  await page.getByRole("table").getByRole("link", { name: /^Open / }).first().click();
  await expect(page).toHaveURL(/\/cases\/[\da-f-]+\/overview/);
  await expect(page.getByRole("heading", { name: "Villa interiors", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Qualified leads", exact: true }).click();
  await expect(page).toHaveURL(root);
  await expect(page.getByText("Select a pre-execution to open this section.")).toHaveCount(0);
});


test("Master Data opens inside Pre-execution and returns to the list", async ({ page }, testInfo) => {
  await signIn(page);
  await page.goto(`${root}/master-data`);
  await expect(page.getByRole("heading", { level: 1, name: "Master Data", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Room grid", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Reception", exact: true })).toBeVisible();
  for (const theme of ["light", "dark"]) {
    const toggle = page.getByRole("button", { name: `Use ${theme} mode` });
    if (await toggle.count()) await toggle.click();
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`catalog-list-${theme}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
  await page.getByRole("button", { name: "Open Reception", exact: true }).click();
  await expect(page.getByRole("table", { name: "Items", exact: true })).toBeVisible();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("master-data-items.png") });
  if (testInfo.project.name === "mobile") await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Pre-execution cases", exact: true }).click();
  await expect(page).toHaveURL(root);
});

test("Master Data keeps room, item, variant and materials in one clear drill-down", async ({ page }, testInfo) => {
  await signIn(page);
  await page.goto(`${root}/master-data`);
  await page.getByRole("button", { name: "Open Workplace", exact: true }).click();
  const items = page.getByRole("table", { name: "Items", exact: true });
  await expect(items).toContainText("Workstations with cable management");
  await items.getByRole("button", { name: "Open Workstations with cable management", exact: true }).click();
  await expect(page.getByRole("table", { name: "Variants", exact: true })).toContainText("Standard workstation");
  await page.getByRole("button", { name: "Open Standard workstation", exact: true }).click();
  const materials = page.getByRole("region", { name: "Materials", exact: true }).getByRole("table", { name: "Item materials", exact: true });
  await expect(materials).toContainText("Carcass");
  await expect(materials).toContainText("MR plywood");
  await expect(page.getByRole("group", { name: "Item sections" })).toBeVisible();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("master-data-materials.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("Master Data uses accessible application controls instead of browser-default selectors", async ({ page }) => {
  await signIn(page);
  await page.goto(`${root}/master-data`);
  await expect(page.locator("select")).toHaveCount(0);
  await page.getByRole("button", { name: "Master Data actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Export master data" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "New catalog" })).toHaveCount(0);
  await page.keyboard.press("Escape");
});
