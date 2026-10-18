import { expect, test, type Page } from "@playwright/test";
import type { LeadFormRecord } from "../lib/crm/lead-forms";

async function openBuilder(page: Page) {
  let record: LeadFormRecord = {
    id: "test-form", token: "test-form-token", status: "draft", version: 1, published: null, updatedAt: "2026-09-09T00:00:00Z",
    draft: { title: "Project enquiry", description: "Tell us about your project.", source: "company", channel: "website", questions: [
      { id: "name", title: "Your name", type: "text", field: "displayName", required: true, description: "", options: [] },
      { id: "mobile", title: "Mobile number", type: "tel", field: "mobile", required: true, description: "", options: [] },
      { id: "email", title: "Email address", type: "email", field: "email", required: true, description: "", options: [] },
      { id: "location", title: "Property location", type: "text", field: "location", required: true, description: "", options: [] },
    ] },
  };
  const saves: LeadFormRecord["draft"][] = [];
  // All writes are intercepted. No live forms, leads or submissions are changed.
  await page.route("**/api/workspace/crm/data/lead-forms**", async route => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON(); saves.push(body.draft);
      record = { ...record, draft: body.draft, version: record.version + 1 };
      await route.fulfill({ json: record });
    } else await route.fulfill({ json: { data: [record] } });
  });
  await page.goto("/workspace/crm/leads?section=forms");
  await page.getByRole("button", { name: "Edit form" }).click();
  await expect(page.getByRole("heading", { name: "Edit field" })).toBeVisible();
  return saves;
}

test("builds, previews, saves and reopens fields on desktop and mobile", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const saves = await openBuilder(page);
  await page.screenshot({ path: testInfo.outputPath("form-builder.png"), fullPage: true });
  await page.getByRole("button", { name: "Add multiple choice", exact: true }).click();
  await page.getByRole("textbox", { name: "Field label", exact: true }).fill("Property type");
  await page.getByRole("textbox", { name: "Option 1", exact: true }).fill("Villa");
  await page.getByRole("textbox", { name: "Option 2", exact: true }).fill("Apartment");
  await page.getByRole("button", { name: "Preview form" }).click();
  const preview = page.getByRole("dialog", { name: "Form preview" });
  await expect(preview.getByRole("radio", { name: "Villa" })).toBeVisible();
  await preview.getByRole("radio", { name: "Villa" }).check();
  await expect(preview.getByRole("button", { name: "Submit enquiry" })).toBeDisabled();
  await preview.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Move Property type up", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  expect(saves[0].questions.map(q => q.title)).toEqual(["Your name", "Mobile number", "Email address", "Property type", "Property location"]);
  await page.getByRole("button", { name: "Back to forms" }).click();
  await page.getByRole("button", { name: "Edit form" }).click();
  await page.getByRole("button", { name: "Preview form" }).click();
  await expect(preview.getByRole("radio", { name: "Villa" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test("drags new fields into position and reorders existing fields", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Touch devices use the tested add and reorder buttons.");
  await page.setViewportSize({ width: 1600, height: 1100 });
  const saves = await openBuilder(page);
  const fields = page.getByRole("grid", { name: "Reorder form fields" });
  const palette = page.getByRole("grid", { name: "Field types" });
  const first = fields.getByRole("row").first();
  // Use real pointer drag, not synthetic callback invocations.
  await palette.getByRole("row").filter({ has: page.getByRole("button", { name: "Add date", exact: true }) }).dragTo(first, { sourcePosition: { x: 10, y: 16 }, targetPosition: { x: 120, y: 2 } });
  await expect(page.getByRole("textbox", { name: "Field label", exact: true })).toHaveValue("Date");
  await expect(fields.getByRole("row").first()).toContainText("Date");
  const location = fields.getByRole("row").filter({ has: page.getByRole("button", { name: "Drag Property location to reorder", exact: true }) });
  await location.dragTo(fields.getByRole("row").first(), { sourcePosition: { x: 12, y: 18 }, targetPosition: { x: 120, y: 2 } });
  await expect(fields.getByRole("row").first()).toContainText("Property location");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  expect(saves[0].questions.map(q => q.title)).toEqual(["Property location", "Date", "Your name", "Mobile number", "Email address"]);
  await page.screenshot({ path: testInfo.outputPath("form-builder-dragged.png"), fullPage: true });
});

test("supports keyboard reordering", async ({ page }, testInfo) => {
  const saves = await openBuilder(page);
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "Move Your name down", exact: true }).focus();
    await page.keyboard.press("Enter");
  } else {
    await page.getByRole("button", { name: "Drag Your name to reorder", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
  }
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  expect(saves[0].questions).toHaveLength(4);
  expect(saves[0].questions[0].id).not.toBe("name");
});
