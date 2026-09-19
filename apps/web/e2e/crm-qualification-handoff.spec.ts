import { expect, test } from "@playwright/test";

const opportunityId = "72000000-0000-4000-8000-000000000001";

test("qualified opportunity keeps the exact enquiry decision visible", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route(`**/api/workspace/crm/data/opportunities/${opportunityId}?**`, route => route.fulfill({ json: {
    id: opportunityId,
    title: "Palm Jumeirah villa renovation",
    partyId: "73000000-0000-4000-8000-000000000001",
    partyName: "Amina Rahman",
    leadId: "74000000-0000-4000-8000-000000000001",
    pipelineId: "75000000-0000-4000-8000-000000000001",
    pipelineName: "Design and build",
    stageName: "Qualified",
    ownerMembershipId: "76000000-0000-4000-8000-000000000001",
    ownerName: "Operations",
    status: "open",
    version: 2,
    conversionOrigin: "lead_qualification",
    qualificationEvidenceHash: "frozen-synthetic-hash",
    qualificationEvidence: {
      version: 1,
      leadId: "74000000-0000-4000-8000-000000000001",
      serviceType: "interior_design",
      selection: "service_specific",
      evaluatedAt: "2026-09-18T07:30:00.000Z",
      form: {
        id: "77000000-0000-4000-8000-000000000001",
        code: "palm-enquiry",
        name: "Palm enquiry",
        version: 4,
        questions: [
          { key: "scope_confirmed", label: "Scope confirmed", dataType: "boolean", required: true },
          { key: "property_type", label: "Property type", dataType: "select", required: true },
        ],
      },
      answers: [
        { questionKey: "scope_confirmed", value: true },
        { questionKey: "property_type", value: "Villa" },
      ],
    },
  } }));
  await page.route("**/api/workspace/crm/data/pipelines?**", route => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/workspace/crm/data/members?**", route => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/workspace/crm/data/parties?**", route => route.fulfill({ json: { data: [] } }));

  await page.goto(`/workspace/crm/opportunities?record=${opportunityId}`);
  const inspector = page.getByRole("dialog", { name: "Opportunity" });
  await expect(inspector).toBeVisible();
  await inspector.getByRole("tab", { name: "Qualification" }).click();
  await expect(inspector.getByText("Qualification handoff is frozen")).toBeVisible();
  await expect(inspector.getByText("Palm enquiry")).toBeVisible();
  await expect(inspector.getByText("Scope confirmed")).toBeVisible();
  await expect(inspector.getByText("Yes")).toBeVisible();
  await expect(inspector.getByText("Property type")).toBeVisible();
  await expect(inspector.getByText("Villa", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("qualification-handoff.png"), fullPage: true });
  expect(errors).toEqual([]);
});
