import { expect, test } from "@playwright/test";

const caseId = "00000000-0000-4000-8000-000000000001";

test("saved Planning links keep their case and section on desktop and mobile", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("/workspace/projects");
  await page.context().addCookies([{ name: "wodana_access", value: "local-e2e-fixture", url: new URL(page.url()).origin }]);

  await page.goto("/workspace/pre-projects/inspirations");
  await expect(page).toHaveURL(/\/workspace\/pre-projects\?section=inspiration/);
  await expect(page.getByRole("table", { name: "Pre-execution cases" })).toBeVisible();
  await page.getByRole("link", { name: "Open Villa interiors" }).click();
  await expect(page).toHaveURL(new RegExp(`/workspace/pre-projects/cases/${caseId}/inspiration`));
  await expect(page.getByRole("heading", { name: "Inspiration" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add inspiration" })).toBeVisible();

  await page.goto(`/workspace/pre-projects/inspirations?record=${caseId}`);
  await expect(page).toHaveURL(new RegExp(`/workspace/pre-projects/cases/${caseId}/inspiration`));

  await page.goto(`/workspace/pre-projects/measurements?record=${caseId}`);
  await expect(page).toHaveURL(new RegExp(`/workspace/pre-projects/cases/${caseId}/requirements\\?section=measurements&tab=measurements`));
  await expect(page.getByRole("button", { name: "Add measurement" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
