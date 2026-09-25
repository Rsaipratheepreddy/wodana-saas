import { test, expect } from "@playwright/test";

const slug = process.env.CLIENT_PORTAL_QA_SLUG ?? "local-portal-audit";
test("client portal keeps five destinations and shared images usable on desktop and mobile", async ({ page }, testInfo) => {
  test.skip(!process.env.CLIENT_PORTAL_QA_SLUG, "Set CLIENT_PORTAL_QA_SLUG to an enabled isolated local fixture portal.");
  const writes: string[] = [];
  await page.route(`**/api/client-portal/${slug}/**`, async route => {
    const request = route.request();
    if (request.method() !== "GET") writes.push(request.url());
    if (request.url().includes("/designs/")) {
      await route.fulfill({ path: "public/brand/wodana/wodana-mark.png" });
      return;
    }
    await route.fulfill({ json: { name: "Local review client", phone: "+971555555555", cases: [{
      id: "case", title: "Local portal layout review", role: "approver", quotes: [], payments: [], requests: [],
      designs: [{ id: "image", title: "Shared design image", number: 1, status: "client_review", mimeType: "image/png", roomName: "Bedroom", type: "Design", name: "design.png" }],
      project: { id: "project", name: "Local layout review", phase: "active", progress: 30, milestones: [], reports: [], documents: [], handovers: [], warrantyClaims: [], alerts: [{ id: "alert", title: "Installation date update", message: "The revised date is being reviewed.", dueDate: "2026-09-21" }] },
    }] } });
  });
  await page.goto(`/portal/${slug}`);
  await expect(page.getByRole("heading", { name: "Hello, Local." })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Client portal sections" }).getByRole("button")).toHaveCount(5);
  for (const button of await page.getByRole("navigation", { name: "Client portal sections" }).getByRole("button").all()) {
    const bounds = await button.boundingBox();
    expect(bounds && bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize()!.width + 1).toBe(true);
  }
  await expect(page.getByRole("img", { name: "Shared design image · V1" })).toBeVisible();
  expect(await page.getByRole("img", { name: "Shared design image · V1" }).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  expect(await overflow()).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("portal-home.png"), fullPage: true });
  await page.getByRole("button", { name: /^Approvals/ }).click();
  await page.getByRole("button", { name: "Designs", exact: true }).click();
  await expect(page.getByRole("table", { name: "Shared designs" })).toBeVisible();
  await expect(page.getByText("For your review", { exact: true })).toBeVisible();
  const rowHeight = await page.getByRole("table", { name: "Shared designs" }).locator("tbody tr").first().evaluate(row => row.getBoundingClientRect().height);
  expect(rowHeight).toBeLessThan(140);
  expect(await overflow()).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("portal-designs.png"), fullPage: true });
  await page.getByRole("button", { name: /^Progress/ }).click();
  await page.getByRole("navigation", { name: "Progress views" }).getByRole("button", { name: /^Alerts/ }).click();
  await expect(page.getByRole("heading", { name: "Installation date update" })).toBeVisible();
  expect(await overflow()).toBe(false);
  expect(writes).toEqual([]);
});
