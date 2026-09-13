import { test, expect } from "@playwright/test";
import { hrmsFixture, openHrms } from "./hrms-fixture";
test("leave cards submit a half day through the workspace API", async ({
  page,
}, testInfo) => {
  const fixture = await hrmsFixture(page);
  await openHrms(page);
  await page.goto("/workspace/hrms/leave");
  await expect(
    page.getByRole("heading", { name: "Recent leave" }),
  ).toBeVisible();
  await expect(page.getByText("10", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Request leave", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Request leave",
    exact: true,
  });
  await dialog.getByRole("button", { name: /Day portion/ }).click();
  await page.getByRole("option", { name: "First half", exact: true }).click();
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Morning appointment");
  await dialog.getByRole("button", { name: "Submit request" }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    fixture.writes.find((w) => w.path === "leave/requests")?.body.dayPart,
  ).toBe("first_half");
  await page.screenshot({
    path: testInfo.outputPath("hrms-leave-cards.png"),
    fullPage: true,
  });
});
test("failed attendance stays on device and retries with the same action ID after reload", async ({
  page,
}) => {
  const fixture = await hrmsFixture(page);
  await openHrms(page);
  await page.getByRole("button", { name: "Check in", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Check in", exact: true });
  await dialog
    .getByLabel("Exception reason")
    .fill("Camera and location unavailable on this device");
  await dialog
    .getByRole("button", { name: "Submit attendance for review" })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry capture" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Retry capture" }),
  ).toBeVisible();
  fixture.allowAction();
  await page.getByRole("button", { name: "Retry capture" }).click();
  await expect(
    page.getByText("Attendance recorded.", { exact: true }),
  ).toBeVisible();
  expect(fixture.attempts()).toBe(2);
  const actions = fixture.writes.filter((w) => w.path === "attendance/actions");
  expect(actions[0].body.actionId).toBe(actions[1].body.actionId);
});
test("sidebar destinations have direct routes and real setup controls", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Desktop sidebar route coverage; mobile navigation is checked separately.",
  );
  await hrmsFixture(page);
  await openHrms(page);
  for (const [label, url, heading] of [
    ["People", "people", "People"],
    ["Workplaces & assignments", "workplaces", "Offices & project sites"],
    ["Calendar & policy", "settings", "Work calendars"],
    ["Leave allowances", "leave-settings", "Leave types"],
    ["Team attendance", "team", "Team attendance"],
    ["Site attendance", "site-attendance", "Site attendance"],
    ["Time summary", "time-summary", "Time summary"],
    ["Leave", "leave", "Leave"],
  ]) {
    await page.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/workspace/hrms/${url}$`));
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  }
});
test("another tab cannot overwrite an unconfirmed attendance capture", async ({
  page,
  context,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "One browser-storage race check is sufficient.",
  );
  const first = await hrmsFixture(page);
  await openHrms(page);
  await expect(
    page.getByRole("button", { name: "Check in", exact: true }),
  ).toBeEnabled();
  const secondPage = await context.newPage();
  const second = await hrmsFixture(secondPage);
  await openHrms(secondPage);
  await expect(
    secondPage.getByRole("button", { name: "Check in", exact: true }),
  ).toBeEnabled();
  for (const tab of [page, secondPage]) {
    await tab.getByRole("button", { name: "Check in", exact: true }).click();
    await tab
      .getByLabel("Exception reason")
      .fill("Camera unavailable during browser test");
    await tab
      .getByRole("button", { name: "Submit attendance for review" })
      .click();
  }
  await expect(
    secondPage.getByText(
      "Another attendance capture is pending. Refresh and retry the saved capture.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(first.attempts()).toBe(1);
  expect(second.attempts()).toBe(0);
  await secondPage.reload();
  await expect(
    secondPage.getByRole("button", { name: "Retry capture" }),
  ).toBeVisible();
  second.allowAction();
  await secondPage.getByRole("button", { name: "Retry capture" }).click();
  await expect(
    secondPage.getByText("Attendance recorded.", { exact: true }),
  ).toBeVisible();
  expect(
    second.writes.find((w) => w.path === "attendance/actions")?.body.actionId,
  ).toBe(
    first.writes.find((w) => w.path === "attendance/actions")?.body.actionId,
  );
});

test("rejected capture keeps its evidence and retries with a review reason", async ({
  page,
}) => {
  const fixture = await hrmsFixture(page);
  fixture.rejectAction();
  await openHrms(page);
  await page.getByRole("button", { name: "Check in", exact: true }).click();
  await page
    .getByLabel("Exception reason")
    .fill("Camera unavailable on this device");
  await page
    .getByRole("button", { name: "Submit attendance for review" })
    .click();
  await expect(page.getByLabel("Reason for review")).toBeVisible();
  await page
    .getByLabel("Reason for review")
    .fill("Connection was delayed while visiting the project site");
  fixture.allowAction();
  await page.getByRole("button", { name: "Retry capture" }).click();
  await expect(
    page.getByText("Attendance recorded.", { exact: true }),
  ).toBeVisible();
  const actions = fixture.writes.filter((w) => w.path === "attendance/actions");
  expect(actions).toHaveLength(2);
  expect(actions[1].body.actionId).toBe(actions[0].body.actionId);
  expect(actions[1].body.captureId).toBe(actions[0].body.captureId);
  expect(actions[1].body.exceptionReason).toBe(
    "Connection was delayed while visiting the project site",
  );
});

test("settings use workspace colors and shared form controls in both themes", async ({
  page,
}, testInfo) => {
  const fixture = await hrmsFixture(page);
  await openHrms(page);
  await page.goto("/workspace/hrms/settings");
  await expect(
    page.getByRole("complementary", { name: "Attendance setup" }),
  ).toBeVisible();
  for (const theme of ["light", "dark"]) {
    const toggle = page.getByRole("button", { name: `Use ${theme} mode` });
    if (await toggle.count()) await toggle.click();
    const button = page.getByRole("button", {
      name: "Create calendar",
      exact: true,
    });
    await expect
      .poll(() => button.evaluate((el) => getComputedStyle(el).backgroundImage))
      .toContain("214, 185, 243");
    expect(await button.evaluate((el) => getComputedStyle(el).color)).toBe(
      "rgb(47, 35, 45)",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(`hrms-settings-${theme}.png`),
    });
  }
  await page.getByRole("button", { name: /Default approver/ }).click();
  await page
    .getByRole("option", { name: "Iglo Administrator", exact: true })
    .click();
  await page.getByRole("button", { name: /Default approver/ }).click();
  await page
    .getByRole("option", { name: "Workspace HR administrators", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Default approver/ }),
  ).toContainText("Workspace HR administrators");
  await page
    .getByRole("button", { name: "Create calendar", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Create work calendar" });
  await dialog
    .getByLabel("Calendar name", { exact: true })
    .fill("Site team calendar");
  await dialog.getByText("Sun", { exact: true }).click();
  await expect(
    dialog.getByRole("checkbox", { name: "Sun", exact: true }),
  ).toBeChecked();
  await dialog
    .getByRole("button", { name: "Create calendar", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(
    fixture.writes.find((w) => w.path === "calendars")?.body.workingDays,
  ).toContain(0);
});
