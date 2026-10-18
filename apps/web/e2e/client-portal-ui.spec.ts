import { test, expect } from "@playwright/test";

const slug = process.env.CLIENT_PORTAL_QA_SLUG ?? "local-portal-audit";

test("client portal: Overview first, the shared sections, photos and decisions usable on desktop and mobile, without writes", async ({ page }, testInfo) => {
  test.skip(!process.env.CLIENT_PORTAL_QA_SLUG, "Set CLIENT_PORTAL_QA_SLUG to an enabled isolated local fixture portal.");
  const writes: string[] = [];
  await page.route(`**/api/client-portal/${slug}/**`, async (route) => {
    const request = route.request();
    if (request.method() !== "GET") writes.push(request.url());
    if (request.url().includes("/files/")) {
      await route.fulfill({ path: "public/brand/logo/wodana-icon.png" });
      return;
    }
    await route.fulfill({ json: {
      contact: { name: "Local review client", nameConfirmed: true, phone: "+15550100001" }, today: "2026-09-27",
      projects: [{
        id: "case", title: "Local layout review", reference: "PRJ-0001", role: "approver", status: "active", paused: false,
        sections: { progress: true, decisions: true, payments: true, documents: true, warranty: false, messages: true },
        manager: "Project manager", stage: { number: 2, total: 5, name: "Production" }, handoverDate: "2026-12-01",
        next: [{ kind: "design", id: "design", title: "Shared design image · V1", due: "2026-10-01" }],
        latestUpdate: { id: "u1", at: "2026-09-25T09:00:00.000Z", text: "Cabinets are in the factory." },
        progress: { stages: [{ name: "Design", state: "done", startedOn: "2026-09-01", finishedOn: "2026-09-10" }, { name: "Production", state: "current", startedOn: "2026-09-11", finishedOn: null }],
          updates: [{ id: "u1", at: "2026-09-25T09:00:00.000Z", text: "Cabinets are in the factory." }], photoDays: [{ on: "2026-09-25", photos: [{ id: "00000000-0000-4000-8000-000000000001" }] }] },
        decisions: { quotes: [], requests: [], definition: null, materials: null, handovers: [],
          designs: [{ id: "00000000-0000-4000-8000-000000000002", title: "Shared design image", type: "Render", number: 1, status: "client_review", dueAt: "2026-10-01T00:00:00.000Z",
            room: "Bedroom", item: null, mimeType: "image/png", canDecide: true }] },
        payments: { currency: "USD", showAmounts: true, milestones: [] }, documents: [], warranty: null, messages: { requests: [], unread: 0 },
      }],
    } });
  });
  await page.goto(`/portal/${slug}`);
  await expect(page.getByRole("heading", { name: "Local layout review" })).toBeVisible();
  await expect(page.getByText("Stage 2 of 5 · Production")).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Sections" }).getByRole("button");
  await expect(tabs).toHaveCount(4);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  expect(await overflow()).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("portal-home.png"), fullPage: true });
  await page.getByRole("button", { name: "Progress" }).click();
  const photo = page.getByRole("img", { name: /Site photo 1/ });
  await expect(photo).toBeVisible();
  expect(await photo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.getByRole("button", { name: /^Decisions/ }).click();
  await page.getByRole("button", { name: /Shared design image · V1/ }).click();
  const dialog = page.getByRole("dialog", { name: "Shared design image · V1" });
  await expect(dialog.getByRole("img", { name: "Shared design image · V1" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Approve" })).toBeVisible();
  expect(await overflow()).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("portal-decision.png"), fullPage: true });
  expect(writes).toEqual([]);
});
