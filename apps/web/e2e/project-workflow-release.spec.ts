import { expect, test } from "@playwright/test";

test("manufacturing readiness is visible, gated, and advances to factory production", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/workspace/projects/demo/overview?view=summary");
  await page.context().addCookies([{ name: "wodana_access", value: "local-e2e-fixture", url: new URL(page.url()).origin }]);

  const stages = [
    { key: "deal_file", visibleName: "Deal File", phase: "planning" },
    { key: "procurement", visibleName: "Procurement", phase: "active", releaseStart: true },
    { key: "manufacturing_readiness", visibleName: "Manufacturing readiness", phase: "active", exitGates: ["production_plan_ready"] },
    { key: "factory_production", visibleName: "Factory production", phase: "active" },
    { key: "snagging", visibleName: "Snagging", phase: "handover", exitGates: ["all_tasks_closed", "all_snags_closed", "all_handovers_accepted", "finance_closed"] },
    { key: "completed", visibleName: "Client handover", phase: "completed" },
  ];
  let ready = false;
  let current = "manufacturing_readiness";
  let revision = 1;
  let submitted: Record<string, unknown> | null = null;
  const data = () => ({
    revision,
    phase: "active",
    workflow: { currentStageKey: current, template: { code: "design_build_deal_first", stages } },
    controls: { onHold: false },
    tasks: [], reports: [], materials: [], orders: [], documents: [], snags: [], handovers: [],
    comments: [], audit: [], processed: [], budget: 0, forecast: 0, financeClosed: false, financeEvidence: "",
  });
  const state = () => ({
    workspaceId: "00000000-0000-4000-8000-000000000001",
    id: "demo", caseId: "demo-case", name: "Palm delivery preview", customer: "Preview client",
    memberId: "pm", canManage: true, canReview: true, canReport: true, canBuy: true, commercialReady: true,
    members: [{ id: "pm", name: "Project manager" }], resources: [], bookings: [],
    pulse: { health: "clear", counts: { packages: 0, readyPackages: 0, activePackages: 0, blockedPackages: 0, overdueTasks: 0, awaitingInspection: 0 }, nextActions: [] },
    data: data(),
    workflowSummary: {
      currentStageKey: current,
      currentStageName: stages.find(stage => stage.key === current)?.visibleName,
      ownerRole: "procurement_production", ownerId: "pm",
      nextStage: current === "manufacturing_readiness"
        ? { key: "factory_production", name: "Factory production" }
        : { key: "snagging", name: "Snagging" },
      exitGates: current === "manufacturing_readiness" ? [{ key: "production_plan_ready", passed: ready }] : [],
    },
  });
  await page.route("**/api/projects/demo/execution?**", route => {
    if (route.request().method() === "POST") {
      submitted = route.request().postDataJSON();
      current = "factory_production";
      revision += 1;
      return route.fulfill({ json: { data: data() } });
    }
    return route.fulfill({ json: state() });
  });

  await page.goto("/workspace/projects/demo/overview?view=summary");
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Refresh project" }).click();
  const strip = page.getByRole("region", { name: "Project stage" });
  await expect(strip).toContainText("Manufacturing readiness");
  await expect(strip).toContainText("Make production packages ready");
  await expect(strip.getByRole("button", { name: "Move to Factory production" })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("manufacturing-readiness-gated.png"), animations: "disabled" });

  ready = true;
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Refresh project" }).click();
  await strip.getByRole("button", { name: "Move to Factory production" }).click();
  await expect.poll(() => submitted).toMatchObject({ action: "workflow_transition", toStageKey: "factory_production" });
  await expect(strip).toContainText("Factory production");
  await expect(strip.getByRole("button", { name: "Move to Snagging" })).toBeEnabled();

  await page.evaluate(() => localStorage.setItem("wodana-theme", "dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Refresh project" }).click();
  await expect(page.getByRole("region", { name: "Project stage" })).toContainText("Factory production");
  await page.evaluate(() => { document.documentElement.dir = "rtl"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("factory-production-dark-rtl.png"), animations: "disabled" });
  expect(errors).toEqual([]);
});
