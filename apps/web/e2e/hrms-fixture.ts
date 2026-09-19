import type { Page } from "@playwright/test";
export const ids = {
  member: "00000000-0000-4000-8000-000000000011",
  calendar: "00000000-0000-4000-8000-000000000012",
  type: "00000000-0000-4000-8000-000000000013",
  workspace: "00000000-0000-4000-8000-000000000002",
};
export async function hrmsFixture(page: Page) {
  const calendar = {
    id: ids.calendar,
    name: "Studio calendar",
    timezone: "Asia/Kolkata",
    workingDays: [1, 2, 3, 4, 5, 6],
    holidays: ["2026-10-02", "2026-12-25"],
    dayStart: "09:00",
    halfDay: "13:00",
    dayEnd: "18:00",
  };
  const types = [
    {
      id: ids.type,
      name: "Casual / sick leave",
      annualDays: 12,
      allowHalfDay: true,
      active: true,
      version: 1,
    },
    {
      id: "00000000-0000-4000-8000-000000000014",
      name: "Earned leave",
      annualDays: 20,
      allowHalfDay: true,
      active: true,
      version: 1,
    },
    {
      id: "00000000-0000-4000-8000-000000000015",
      name: "Personal leave",
      annualDays: 5,
      allowHalfDay: false,
      active: true,
      version: 1,
    },
  ];
  const requests: Record<string, unknown>[] = [
    {
      id: "00000000-0000-4000-8000-000000000017",
      membershipId: ids.member,
      name: "Iglo Administrator",
      leaveTypeId: ids.type,
      leaveTypeName: types[0].name,
      startDate: "2026-08-25",
      endDate: "2026-08-25",
      dayPart: "full",
      days: 1,
      reason: "Medical appointment",
      status: "approved",
      canDecide: false,
      version: 1,
    },
  ];
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  let actionAttempts = 0,
    failAction = true,
    failureStatus = 503;
  await page.route("**/api/workspace/hrms/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname.split("/hrms/")[1];
    let data: unknown = null;
    if (route.request().method() !== "GET") {
      const body = route.request().postDataJSON();
      writes.push({ path, body });
      if (path === "attendance/actions") {
        actionAttempts++;
        if (failAction) {
          await route.fulfill({
            status: failureStatus,
            json: {
              message:
                failureStatus === 400
                  ? "Capture needs a reason for review"
                  : "Connection interrupted",
            },
          });
          return;
        }
        data = { id: "recorded" };
      } else if (path === "leave/requests") {
        requests.unshift({
          ...body,
          id: "00000000-0000-4000-8000-000000000018",
          membershipId: ids.member,
          leaveTypeName: types[0].name,
          days: body.dayPart === "full" ? 1 : 0.5,
          status: "pending",
          canDecide: false,
        });
        data = { id: "new-request" };
      } else data = { id: body.id ?? "saved" };
    } else if (path === "bootstrap")
      data = {
        membershipId: ids.member,
        employee: {
          membershipId: ids.member,
          name: "Iglo Administrator",
          enabled: true,
          calendar,
          remoteAllowed: true,
          version: 1,
        },
        settings: {
          defaultCalendarId: ids.calendar,
          maxGpsAccuracyM: 100,
          maxCaptureAgeSeconds: 120,
          mediaRetentionDays: 365,
          version: 1,
        },
        calendars: [calendar],
        workspace: { name: "Iglo Architects", timezone: "Asia/Kolkata" },
        permissions: {
          self: true,
          team: true,
          manage: true,
          evidence: true,
          manageProjects: true,
        },
      };
    else if (path === "attendance/history")
      data = {
        from: url.searchParams.get("from"),
        to: url.searchParams.get("to"),
        days: [],
        sessions: [],
        segments: [],
        events: [],
        reviews: [],
      };
    else if (path === "leave/types") data = types;
    else if (path === "leave/requests") data = requests;
    else if (path === "leave/balances")
      data = types.map((t, i) => ({
        membershipId: ids.member,
        name: "Iglo Administrator",
        leaveTypeId: t.id,
        leaveTypeName: t.name,
        year: 2026,
        allowance: t.annualDays,
        used: [2, 5, 0][i],
        pending: 0,
        available: t.annualDays - [2, 5, 0][i],
        version: 1,
      }));
    else if (path === "people")
      data = [
        {
          membershipId: ids.member,
          name: "Iglo Administrator",
          status: "active",
          enabled: true,
          calendarId: ids.calendar,
          employeeCode: "IG-001",
          designation: "Studio lead",
          department: "Design",
          version: 1,
        },
      ];
    else if (path === "reviews") data = [];
    await route.fulfill({ json: data });
  });
  await page.route("**/api/workspace/projects/**", (route) =>
    route.fulfill({ json: [] }),
  );
  return {
    writes,
    rejectAction: () => {
      failureStatus = 400;
    },
    allowAction: () => {
      failAction = false;
    },
    attempts: () => actionAttempts,
  };
}

export async function openHrms(page: Page) {
  await page.goto("/workspace/hrms");
  if (new URL(page.url()).pathname === "/login") {
    const credentials = {
      email: process.env.E2E_LOGIN_EMAIL ?? "admin@igloarchitects.com",
      password: process.env.E2E_LOGIN_PASSWORD ?? "IgloDemo#2026",
      tenantSlug: process.env.E2E_TENANT_SLUG ?? "iglo-architects",
    };
    let response = await page.request.post("/api/auth/login", {
      data: credentials,
    });
    if (response.status() === 409 && process.env.E2E_RECLAIM_DEVICE === "true") {
      const payload = await response.json();
      const previousTestSession = payload.sessions?.find(
        (session: { familyId?: string; userAgent?: string }) =>
          session.familyId &&
          /Playwright|HeadlessChrome|Windows NT/i.test(session.userAgent ?? ""),
      );
      if (previousTestSession?.familyId)
        response = await page.request.post("/api/auth/login", {
          data: {
            ...credentials,
            revokeFamilyId: previousTestSession.familyId,
          },
        });
    }
    if (!response.ok()) throw new Error("Local demo login failed.");
    await page.goto("/workspace/hrms");
  }
}
