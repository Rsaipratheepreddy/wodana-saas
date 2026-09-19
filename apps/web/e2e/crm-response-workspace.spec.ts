import { expect, test } from "@playwright/test";

const leadId = "62000000-0000-4000-8000-000000000001";

test("enquiry response workspace keeps provenance, actions and delivery truth clear", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route(`**/api/workspace/crm/data/leads/${leadId}?**`, route => route.fulfill({ json: {
    id: leadId,
    partyId: "63000000-0000-4000-8000-000000000001",
    status: "new",
    ownerMembershipId: "10000000-0000-4000-8000-000000000001",
    ownerName: "Iglo Administrator",
    queueId: "61000000-0000-4000-8000-000000000001",
    nextActionAt: "2026-09-18T08:30:00.000Z",
    ownershipDueAt: "2026-09-18T08:00:00.000Z",
    version: 2,
    enquiry: {
      id: "64000000-0000-4000-8000-000000000001",
      partyName: "Dr Maya Nair",
      title: "Dubai wellness clinic design",
      summary: "A calm, accessible wellness clinic interior.",
      serviceType: "interior_design",
      source: "company",
      channel: "website",
      intakeMethod: "form",
      receivedAt: "2026-09-18T06:55:00.000Z",
      processedAt: "2026-09-18T06:55:02.000Z",
      primaryMobile: "+971501234567",
      primaryEmail: "maya@example.test",
      correlationId: "synthetic-response-acceptance",
      details: { location: "Dubai", budgetRange: "250k_500k" },
      attribution: [{ id: "touch-1", source: "instagram", medium: "shared_link", campaign: "September homes", touchedAt: "2026-09-18T06:54:00.000Z" }],
    },
    assignments: [{ id: "assignment-1", ownerMembershipId: "10000000-0000-4000-8000-000000000001", assignmentMethod: "automatic", assignedAt: "2026-09-18T06:55:02.000Z" }],
    sla: [{ id: "sla-1", status: "active", dueAt: "2026-09-18T08:00:00.000Z", respondedAt: null }],
    qualification: [],
    qualificationState: { ready: false, missingRequired: [], form: null },
    opportunities: [],
  } }));
  await page.route("**/api/workspace/crm/data/activities?**", route => route.fulfill({ json: { data: [{
    id: "activity-1", type: "call", interactionDirection: "outbound", status: "pending",
    title: "Call customer", description: "Confirm the preferred consultation time.",
    dueAt: "2026-09-18T08:30:00.000Z", isNextAction: true, version: 1,
  }], nextCursor: null } }));

  await page.goto(`/workspace/crm/leads?lead=${leadId}`);
  const inspector = page.getByRole("dialog", { name: "Enquiry details" });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole("tab", { name: "Response" })).toHaveAttribute("aria-selected", "true");
  await expect(inspector.getByText("Contact action is not delivery proof")).toBeVisible();
  await expect(inspector.getByRole("button", { name: "Call" })).toBeEnabled();
  await expect(inspector.getByRole("button", { name: "Email" })).toBeEnabled();
  await expect(inspector.getByRole("button", { name: "WhatsApp" })).toBeEnabled();
  await expect(inspector.getByText("Call customer")).toBeVisible();
  await inspector.getByRole("tab", { name: "Provenance" }).click();
  await expect(inspector.getByText("Instagram")).toBeVisible();
  await expect(inspector.getByText(/shared link · September homes/i)).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("crm-response-light.png"), fullPage: true });

  await inspector.getByRole("button", { name: "Close inspector" }).click();
  await expect(inspector).toBeHidden();
  await page.getByRole("button", { name: "Use dark mode" }).click();
  await page.goto(`/workspace/crm/leads?lead=${leadId}`);
  const darkInspector = page.getByRole("dialog", { name: "Enquiry details" });
  await expect(darkInspector).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("crm-response-dark.png"), fullPage: true });
  expect(errors).toEqual([]);
});
