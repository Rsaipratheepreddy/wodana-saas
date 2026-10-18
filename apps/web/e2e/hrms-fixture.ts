import type { Page } from "@playwright/test";
export const ids = {
  member: "00000000-0000-4000-8000-000000000011",
  calendar: "00000000-0000-4000-8000-000000000012",
  type: "00000000-0000-4000-8000-000000000013",
  workspace: "00000000-0000-4000-8000-000000000002",
};
/** The HRMS and projects proxies for one person who manages HR; attendance actions fail until allowed. */
export async function hrmsFixture(page: Page) {
  const calendar = {
    id: ids.calendar, name: "Studio calendar", timezone: "Asia/Kolkata", workingDays: [1, 2, 3, 4, 5, 6], holidays: ["2026-10-02"], dayStart: "09:00", halfDay: "13:00", dayEnd: "18:00", version: 1,
  };
  const types = [
    { id: ids.type, name: "Annual leave", limited: true, annualDays: 12, allowHalfDay: true, paid: true, active: true, version: 1 },
    { id: "00000000-0000-4000-8000-000000000014", name: "Sick leave", limited: false, annualDays: 0, allowHalfDay: false, paid: true, active: true, version: 1 },
  ];
  const requests: Record<string, unknown>[] = [];
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  let actionAttempts = 0, failAction = true, failure: { status: number; json: Record<string, unknown> } = { status: 503, json: { message: "Connection interrupted" } }, checkedIn = false;
  const session = () => ({ id: "00000000-0000-4000-8000-000000000020", startedAt: new Date().toISOString(), endedAt: null, calendar, version: 1, pendingReviewCount: 0, rejectedReviewCount: 0,
    segments: [{ id: "g1", mode: "field", locationId: null, projectId: null, caseId: null, context: { name: "General work", location: null }, startedAt: new Date().toISOString(), endedAt: null }] });
  await page.route("**/api/workspace/hrms/**", async (route) => {
    const url = new URL(route.request().url()), path = url.pathname.split("/hrms/")[1];
    let data: unknown = null;
    if (route.request().method() !== "GET") {
      const body = path.endsWith("/photo") ? {} : route.request().postDataJSON();
      writes.push({ path, body });
      if (path === "attendance/actions") {
        actionAttempts++;
        if (failAction) { await route.fulfill({ status: failure.status, json: failure.json }); return; }
        checkedIn = body.kind !== "check_out";
        data = { event: { id: "recorded" }, current: checkedIn ? session() : null, replayed: false };
      } else if (path === "leave/requests") {
        requests.unshift({ ...body, id: "00000000-0000-4000-8000-000000000018", membershipId: ids.member, name: "Iglo Administrator", leaveTypeName: types[0].name,
          days: body.dayPart === "full" ? 1 : 0.5, status: "pending", decisionReason: null, cancellationReason: null, createdAt: new Date().toISOString(), version: 1, canDecide: false });
        data = { id: "00000000-0000-4000-8000-000000000018", status: "pending" };
      } else data = { id: body.id ?? "saved" };
    } else if (path === "bootstrap")
      data = {
        membershipId: ids.member,
        employee: { membershipId: ids.member, userId: ids.member, name: "Iglo Administrator", enabled: true, remoteAllowed: true, managerId: null, activeFrom: "2026-01-01", activeTo: null, calendar, version: 1 },
        settings: { defaultCalendarId: ids.calendar, fallbackApproverId: null, maxGpsAccuracyM: 100, maxCaptureAgeSeconds: 120, mediaRetentionDays: 365, version: 1 },
        calendars: [calendar],
        workspace: { name: "Iglo Architects", timezone: "Asia/Kolkata" },
        permissions: { self: true, team: true, manage: true, evidence: true, manageProjects: true },
      };
    else if (path === "attendance/current") data = checkedIn ? session() : null;
    else if (path === "attendance/history")
      data = { from: url.searchParams.get("from"), to: url.searchParams.get("to"), days: [], sessions: [], segments: [], events: [], reviews: [] };
    else if (path === "calendars") data = [{ ...calendar, holidayList: [], people: 1, isDefault: true }];
    else if (path === "leave/types") data = types;
    else if (path === "leave/requests") data = requests;
    else if (path === "leave/balances")
      data = types.map((type) => ({ membershipId: ids.member, name: "Iglo Administrator", leaveTypeId: type.id, leaveTypeName: type.name, year: 2026, limited: type.limited,
        allowance: type.limited ? type.annualDays : null, used: 2, pending: 0, available: type.limited ? type.annualDays - 2 : null, version: 1 }));
    else if (path === "people")
      data = [{ membershipId: ids.member, name: "Iglo Administrator", email: "admin@igloarchitects.com", status: "active", enabled: true, calendarId: ids.calendar, employeeCode: "IG-001",
        designation: "Studio lead", department: "Design", managerId: null, remoteAllowed: true, activeFrom: "2026-01-01", activeTo: null, version: 1 }];
    else if (path === "reviews") data = [];
    await route.fulfill({ json: data });
  });
  await page.route("**/api/workspace/projects**", (route) => route.fulfill({ json: [] }));
  return {
    writes,
    /** The next attendance actions are refused for want of a reason. */
    rejectAction: () => { failure = { status: 400, json: { message: "Retry the capture or provide an exception reason.", issues: ["Location missing"] } }; },
    allowAction: () => { failAction = false; },
    attempts: () => actionAttempts,
  };
}

export async function openHrms(page: Page, path = "/workspace/hrms") {
  await page.goto(path);
  if (new URL(page.url()).pathname === "/login") {
    const credentials = {
      email: process.env.E2E_LOGIN_EMAIL ?? "admin@igloarchitects.com",
      password: process.env.E2E_LOGIN_PASSWORD ?? "IgloDemo#2026",
      tenantSlug: process.env.E2E_TENANT_SLUG ?? "iglo-architects",
    };
    let response = await page.request.post("/api/auth/login", { data: credentials });
    if (response.status() === 409 && process.env.E2E_RECLAIM_DEVICE === "true") {
      const payload = await response.json();
      const previousTestSession = payload.sessions?.find((session: { familyId?: string; userAgent?: string }) =>
        session.familyId && /Playwright|HeadlessChrome|Windows NT/i.test(session.userAgent ?? ""));
      if (previousTestSession?.familyId) response = await page.request.post("/api/auth/login", { data: { ...credentials, revokeFamilyId: previousTestSession.familyId } });
    }
    if (!response.ok()) throw new Error("Local demo login failed.");
    await page.goto(path);
  }
}
