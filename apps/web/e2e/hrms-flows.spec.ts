import { test, expect, type Page } from "@playwright/test";
import { hrmsFixture, openHrms } from "./hrms-fixture";

/** Check in from People with no camera or location in the test browser: a reason goes with it. */
async function checkIn(page: Page, reason: string) {
  await page.getByRole("button", { name: "Check in", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Check in", exact: true });
  await dialog.getByRole("radio", { name: "Field", exact: true }).click();
  await dialog.getByLabel("Reason for review").fill(reason);
  await dialog.getByRole("button", { name: "Check in", exact: true }).click();
  return dialog;
}

test("a capture that couldn't be sent stays on the device and goes again with the same action after a reload", async ({ page }) => {
  const fixture = await hrmsFixture(page);
  await openHrms(page);
  const dialog = await checkIn(page, "Camera and location unavailable on this device");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Not sent yet", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Not sent yet", { exact: true })).toBeVisible();
  fixture.allowAction();
  await page.getByRole("button", { name: "Send now" }).click();
  await expect(page.getByRole("button", { name: "Check out", exact: true })).toBeVisible();
  expect(fixture.attempts()).toBe(2);
  const actions = fixture.writes.filter((write) => write.path === "attendance/actions");
  expect(actions[1].body.actionId).toBe(actions[0].body.actionId);
});

test("another tab can't overwrite a capture waiting on this device", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One browser-storage race check is enough.");
  const first = await hrmsFixture(page);
  await openHrms(page);
  await expect(page.getByRole("button", { name: "Check in", exact: true })).toBeEnabled();
  const secondPage = await context.newPage();
  const second = await hrmsFixture(secondPage);
  await openHrms(secondPage);
  await expect(secondPage.getByRole("button", { name: "Check in", exact: true })).toBeEnabled();
  for (const tab of [page, secondPage]) await checkIn(tab, "Camera unavailable during browser test");
  // The second tab shows the first tab's capture, waiting; its own was never sent.
  await expect(secondPage.getByText("Not sent yet", { exact: true })).toBeVisible();
  expect(first.attempts()).toBe(1);
  expect(second.attempts()).toBe(0);
  second.allowAction();
  await secondPage.getByRole("button", { name: "Send now" }).click();
  await expect(secondPage.getByRole("button", { name: "Check out", exact: true })).toBeVisible();
  expect(second.writes.find((write) => write.path === "attendance/actions")?.body.actionId)
    .toBe(first.writes.find((write) => write.path === "attendance/actions")?.body.actionId);
});

test("a capture refused for its evidence goes again with a reason, as the same action", async ({ page }) => {
  const fixture = await hrmsFixture(page);
  fixture.rejectAction();
  await openHrms(page);
  const dialog = await checkIn(page, "Camera unavailable");
  await expect(dialog.getByText("Needs a reason")).toBeVisible();
  await dialog.getByLabel("Reason for review").fill("Connection was delayed while visiting the project site");
  fixture.allowAction();
  await dialog.getByRole("button", { name: "Send for review" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Check out", exact: true })).toBeVisible();
  const actions = fixture.writes.filter((write) => write.path === "attendance/actions");
  expect(actions).toHaveLength(2);
  expect(actions[1].body.actionId).toBe(actions[0].body.actionId);
  expect(actions[1].body.captureId).toBe(actions[0].body.captureId);
  expect(actions[1].body.exceptionReason).toBe("Connection was delayed while visiting the project site");
});

test("leave for half a day is asked for through the workspace API", async ({ page }, testInfo) => {
  const fixture = await hrmsFixture(page);
  await openHrms(page, "/workspace/hrms/leave");
  await expect(page.getByText("Annual leave · 10 of 12 left")).toBeVisible();
  await expect(page.getByText("Sick leave · 2 used")).toBeVisible();
  await page.getByRole("button", { name: "Request leave", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Request leave", exact: true });
  await dialog.getByRole("button", { name: /Type/ }).click();
  await page.getByRole("option", { name: /Annual leave/ }).click();
  const from = dialog.getByRole("group", { name: /From/ });
  for (const [segment, value] of [["month", "10"], ["day", "20"], ["year", "2026"]]) {
    await from.getByRole("spinbutton", { name: new RegExp(`^${segment}`, "i") }).click();
    await page.keyboard.type(value);
  }
  await dialog.getByRole("radio", { name: "First half", exact: true }).click();
  await dialog.getByLabel("Reason").fill("Morning appointment");
  await dialog.getByRole("button", { name: "Send request" }).click();
  await expect(dialog).toHaveCount(0);
  expect(fixture.writes.find((write) => write.path === "leave/requests")?.body).toMatchObject({ startDate: "2026-10-20", endDate: "2026-10-20", dayPart: "first_half" });
  await page.screenshot({ path: testInfo.outputPath("people-leave.png"), fullPage: true });
});

test("People and its settings fit the screen in both themes and both directions", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await hrmsFixture(page);
  for (const path of ["/workspace/hrms", "/workspace/hrms/team", "/workspace/hrms/people", "/workspace/settings/attendance"]) {
    await openHrms(page, path);
    await expect(page.getByRole("heading", { level: 1, name: path.includes("settings") ? "Attendance & leave" : "People" })).toBeVisible();
    for (const direction of ["ltr", "rtl"]) {
      await page.evaluate((dir) => { document.documentElement.dir = dir; }, direction);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
    await page.screenshot({ path: testInfo.outputPath(`${path.replaceAll("/", "-")}.png`), fullPage: true });
  }
  await page.goto("/workspace/hrms/time-summary");
  await expect(page).toHaveURL(/\/workspace\/hrms$/);
  expect(errors).toEqual([]);
});
