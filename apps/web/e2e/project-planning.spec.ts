import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page) {
  const session = await page.request.post("/api/auth/login", {
    data: {
      email: "admin@igloarchitects.com",
      password: "IgloDemo#2026",
      tenantSlug: "iglo-architects",
    },
  });
  expect(session.ok()).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await page.goto("/workspace/projects/demo/plan-teams");
  await expect(
    page.getByRole("region", { name: "Schedules workspace" }),
  ).toBeVisible();
});

test("moves through the connected schedule, task, resource and calendar views", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await expect(
    page.getByRole("radio", { name: "Schedule & milestones" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByRole("heading", { name: "Milestones" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Task timeline" }),
  ).toBeVisible();

  await page.getByRole("radio", { name: "Tasks" }).click();
  await expect(
    page
      .getByRole("region", { name: "Project task board" })
      .or(page.getByText("No tasks match this view", { exact: true })),
  ).toBeVisible();

  await page.getByRole("radio", { name: "Teams & bookings" }).click();
  await expect(
    page.getByRole("region", { name: "Project resources" }),
  ).toBeVisible();

  await page.getByRole("radio", { name: "Calendar" }).click();
  await expect(
    page.getByRole("heading", { name: "Working hours & exceptions" }),
  ).toBeVisible();
  await expect(page.getByText(/Bookings use the resource shift/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("keeps the planning workspace usable across themes and viewport sizes", async ({
  page,
}) => {
  await page.getByRole("radio", { name: "Teams & bookings" }).click();
  await expect(
    page.getByRole("region", { name: "Project resources" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Use dark mode" }).click();
  await expect(
    page.getByRole("button", { name: "Use light mode" }),
  ).toBeVisible();

  await page.getByRole("radio", { name: "Schedule & milestones" }).click();
  await expect(
    page.getByRole("heading", { name: "Milestones" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
});
