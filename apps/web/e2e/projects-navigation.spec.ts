import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/workspace/projects");
  await page.context().addCookies([{ name: "wodana_access", value: "local-e2e-fixture", url: new URL(page.url()).origin }]);
  await page.goto("/workspace/projects");
  await expect(page.getByRole("table", { name: "Client projects" })).toBeVisible();
}

test("production opens the project workspace and its delivery sections", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await signIn(page);
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Production" }).click();
  await expect(page).toHaveURL("/workspace/projects?view=production");
  await page.getByRole("table", { name: "Client projects" }).getByRole("link", { name: "Jumeirah villa interiors" }).click();
  await expect(page).toHaveURL(/\/workspace\/projects\/demo\/overview(?:\?|$)/);
  await expect(page.getByRole("region", { name: "Project items workspace" })).toBeVisible();

  const root = "/workspace/projects/demo";
  for (const [name, section] of [
    ["Supply", "material-planning"],
    ["Work", "plan-teams"],
    ["Quality & handover", "handover"],
    ["Budget & payments", "commercial"],
    ["Files", "documents"],
    ["Project", "overview"],
  ] as const) {
    await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${root}/${section}(?:\\?|$)`));
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
  expect(errors).toEqual([]);
});

test("planning and production lists preserve distinct projects and a useful empty search", async ({ page }) => {
  await signIn(page);
  const table = page.getByRole("table", { name: "Client projects" });
  await expect(table.getByRole("link", { name: "Villa interiors", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Production" }).click();
  await expect(table.getByRole("link", { name: "Villa interiors", exact: true })).toHaveCount(0);
  await expect(table.getByRole("link", { name: "Jumeirah villa interiors" })).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search projects" });
  await search.fill("__no_matching_project__");
  await expect(page.getByText("No matching production projects", { exact: true })).toBeVisible();
  await search.fill("");
  await expect(table.getByRole("link", { name: "Jumeirah villa interiors" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
