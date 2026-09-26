import { expect, test } from "@playwright/test";

const caseId = "00000000-0000-4000-8000-000000000001";
const root = `/workspace/pre-projects/cases/${caseId}`;

test("project entry and client planning sequence stay usable on desktop and mobile", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("/workspace/projects");
  await page.context().addCookies([{ name: "wodana_access", value: "local-e2e-fixture", url: new URL(page.url()).origin }]);
  await page.goto("/workspace/pre-projects");
  await expect(page.getByRole("table", { name: "Client projects" })).toBeVisible();
  await page.getByRole("button", { name: "Start planning" }).click();
  await expect(page.getByRole("dialog", { name: "Start planning" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search opportunities" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto(`${root}/requirements`);
  const navigation = page.getByRole("navigation", { name: "Planning sections" });
  const sequence = [
    ["Overview", "overview"],
    ["Brief", "requirements"],
    ["Design", "designs"],
    ["Quotes", "boq"],
    ["Agreement", "contracts"],
  ] as const;
  await expect(navigation.getByRole("link")).toHaveCount(5);
  for (const [label, section] of sequence) {
    const link = navigation.getByRole("link", { name: label });
    await expect(link).toHaveAttribute("href", `${root}/${section}`);
    await link.click();
    await expect(page).toHaveURL(`${root}/${section}`);
    await expect(page.getByRole("navigation", { name: "Planning sections" }).getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
  const darkMode = page.getByRole("button", { name: "Use dark mode" });
  if (await darkMode.count()) {
    await darkMode.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
  await page.evaluate(() => { document.documentElement.dir = "rtl"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(pageErrors).toEqual([]);
});
