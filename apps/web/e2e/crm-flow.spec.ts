import { expect, test, type Locator, type Page } from "@playwright/test";
import type { FlowDefinition } from "../lib/crm/flow-editor";

const workflowId = "e2e00000-0000-4000-8000-000000000002";

async function openEditor(page: Page) {
  let workflow = {
    id: workflowId, name: "Follow-up canvas check", description: "Browser-only workflow", status: "draft", version: 1, draftVersionNumber: 1,
    definition: {
      nodes: [
        { key: "start", type: "trigger", configuration: { eventTypes: ["crm.enquiry.ready.v1"] }, position: { x: 0, y: 0 } },
        { key: "end", type: "end", configuration: {}, position: { x: 0, y: 380 } },
      ], edges: [{ from: "start", to: "end" }], retainedMetadata: "keep",
    } as FlowDefinition,
    validation: { valid: true, errors: [], warnings: [] },
  };
  const saves: { version: number; definition: FlowDefinition }[] = [];
  // Browser-only fixture: no workflow changes or external actions reach the server.
  await page.route(`**/api/workspace/crm/data/automations/${workflowId}?**`, async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      saves.push(body);
      workflow = { ...workflow, ...body, version: workflow.version + 1, draftVersionNumber: workflow.draftVersionNumber + 1 };
    }
    await route.fulfill({ json: workflow });
  });
  await page.goto(`/workspace/crm/automations?record=${workflowId}`);
  if (new URL(page.url()).pathname === "/login") {
    const session = await page.request.post("/api/auth/login", { data: { email: "admin@igloarchitects.com", password: "IgloDemo#2026", tenantSlug: "iglo-architects" } });
    expect(session.ok()).toBe(true);
    await page.goto(`/workspace/crm/automations?record=${workflowId}`);
  }
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  return saves;
}

async function dragBetween(page: Page, from: Locator, to: Locator) {
  const source = await from.boundingBox(), target = await to.boundingBox();
  expect(source).not.toBeNull(); expect(target).not.toBeNull();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 20 });
  await page.mouse.up();
}

test("automation canvas fills the page, has visible connectors, and follows both themes", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await openEditor(page);
  await expect(page.getByRole("link", { name: "Back to CRM" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Workflows", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add Follow-up task" })).toHaveAttribute("draggable", "true");
  await expect(page.locator(".react-flow__edge-path")).toHaveCount(1);
  for (const theme of ["light", "dark"]) {
    const toggle = page.getByRole("button", { name: `Use ${theme} mode` });
    if (await toggle.count()) await toggle.click();
    const layout = await page.evaluate(() => {
      const canvas = document.querySelector(".react-flow")!.getBoundingClientRect();
      const path = document.querySelector(".react-flow__edge-path")!;
      return { width: canvas.width, height: canvas.height, viewport: innerWidth, horizontal: document.documentElement.scrollWidth - innerWidth, vertical: document.documentElement.scrollHeight - innerHeight, stroke: getComputedStyle(path).stroke, svgWidth: path.closest("svg")!.getBoundingClientRect().width };
    });
    expect(layout.width).toBeGreaterThanOrEqual(layout.viewport - 2);
    expect(layout.height).toBeGreaterThan(450);
    expect(layout.horizontal).toBeLessThanOrEqual(1);
    expect(layout.vertical).toBeLessThanOrEqual(1);
    expect(layout.stroke).not.toBe("none");
    expect(layout.svgWidth).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Focus canvas" }).click();
    await page.screenshot({ path: testInfo.outputPath(`flow-${theme}.png`) });
  }
  expect(errors).toEqual([]);
});

test("drops a step, connects handles, moves it, undoes and saves positions without publishing", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop pointer graph wiring; touch and keyboard alternative are covered separately.");
  const saves = await openEditor(page);
  const canvas = page.locator(".react-flow");
  const bounds = (await canvas.boundingBox())!;
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await page.getByRole("button", { name: "Add Wait", exact: true }).dispatchEvent("dragstart", { dataTransfer });
  await canvas.dispatchEvent("dragover", { dataTransfer });
  await canvas.dispatchEvent("drop", { dataTransfer, clientX: bounds.x + bounds.width * .7, clientY: bounds.y + bounds.height * .5 });
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await expect(page.getByRole("button", { name: /Save draft/ })).toBeDisabled();
  await page.getByRole("button", { name: "Focus canvas" }).click();
  const dropped = page.locator('.react-flow__node[data-id^="step_"]');
  const key = (await dropped.getAttribute("data-id"))!;
  await dragBetween(page, page.getByLabel("Next output for start", { exact: true }), page.getByLabel(`Input for ${key}`, { exact: true }));
  await dragBetween(page, page.getByLabel(`Next output for ${key}`, { exact: true }), page.getByLabel("Input for end", { exact: true }));
  await expect(page.locator(".react-flow__edge-path")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /Save draft/ })).toBeEnabled();
  const before = (await dropped.boundingBox())!;
  await page.mouse.move(before.x + 100, before.y + 30); await page.mouse.down();
  await page.mouse.move(before.x + 50, before.y - 20, { steps: 12 }); await page.mouse.up();
  const moved = (await dropped.boundingBox())!;
  expect(moved.x).toBeLessThan(before.x - 20);
  await page.getByRole("button", { name: "Undo canvas change" }).click();
  await expect.poll(async () => (await dropped.boundingBox())!.x).toBeCloseTo(before.x, 0);
  await page.getByRole("button", { name: "Redo canvas change" }).click();
  await expect.poll(async () => (await dropped.boundingBox())!.x).toBeCloseTo(moved.x, 0);
  await page.getByRole("button", { name: "All workflows", exact: true }).click();
  const discard = page.getByRole("dialog", { name: "Discard workflow changes?" });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Keep editing" }).click();
  await page.getByRole("button", { name: /Save draft/ }).click();
  await page.getByRole("dialog", { name: "Save workflow draft" }).getByRole("button", { name: "Save draft" }).click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].version).toBe(1);
  expect(saves[0].definition.retainedMetadata).toBe("keep");
  expect(saves[0].definition.edges).toEqual([{ from: "start", to: key }, { from: key, to: "end" }]);
  expect(saves[0].definition.nodes.find((step) => step.key === key)?.position).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
  await expect(page.getByRole("button", { name: /Save draft/ })).toBeDisabled();
  await page.reload();
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await expect(page.locator(".react-flow__edge-path")).toHaveCount(2);
});

test("tap and keyboard controls configure independent Yes and No paths", async ({ page }) => {
  const saves = await openEditor(page);
  const addCondition = page.getByRole("button", { name: "Add Condition", exact: true });
  await addCondition.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Event field path")).toHaveValue("event.leadId");
  const key = (await page.locator('.react-flow__node[data-id^="step_"]').getAttribute("data-id"))!;
  for (const port of ["Yes", "No"]) {
    await page.getByRole("button", { name: new RegExp(`${port} connects to`) }).click();
    await page.getByRole("option", { name: "End · end", exact: true }).click();
  }
  await page.getByRole("button", { name: "Step list", exact: true }).click();
  await page.getByRole("button", { name: /Trigger.*An enquiry is ready/ }).click();
  await page.getByRole("button", { name: /Next connects to/ }).click();
  await page.getByRole("option", { name: `Filter · ${key}`, exact: true }).click();
  await expect(page.getByRole("button", { name: /Save draft/ })).toBeEnabled();
  await page.getByRole("button", { name: /Save draft/ }).click();
  await page.getByRole("dialog", { name: "Save workflow draft" }).getByRole("button", { name: "Save draft" }).click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].definition.edges).toEqual([{ from: "start", to: key }, { from: key, to: "end", when: "true" }, { from: key, to: "end", when: "false" }]);
  expect(saves[0].definition.nodes.find((step) => step.key === key)?.configuration).toEqual({ condition: { path: "event.leadId", operator: "exists" } });
});
