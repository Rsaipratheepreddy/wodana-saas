import { describe, it, expect } from "vitest";
import { allowedHrmsRoute, allowedProjectsRoute, hrmsUpload, streamedHrmsRoute } from "./routes";
import { hrmsUrl, localDay, wallTime, zonedInstant } from "./client";
import { hrmsHref } from "./sections";

const ID = "00000000-0000-4000-8000-000000000001";

describe("HRMS web boundary", () => {
  it("allows supported resources and rejects arbitrary backend paths", () => {
    expect(allowedHrmsRoute("POST", "attendance/actions")).toBe(true);
    expect(allowedHrmsRoute("PUT", `people/${ID}`)).toBe(true);
    for (const path of ["../auth", "people", "settings/anything", "attendance/actions?admin=1"])
      expect(allowedHrmsRoute("POST", path)).toBe(false);
    expect(allowedHrmsRoute("DELETE", "settings")).toBe(false);
    expect(allowedProjectsRoute("POST", "from-pre-project")).toBe(false);
    expect(allowedProjectsRoute("GET", "workflow-templates")).toBe(true);
    expect(allowedProjectsRoute("GET", `workflow-templates/${ID}/history`)).toBe(true);
    expect(allowedProjectsRoute("PUT", `workflow-templates/${ID}`)).toBe(true);
    expect(allowedProjectsRoute("POST", `workflow-templates/${ID}/rollback`)).toBe(true);
    expect(allowedProjectsRoute("PUT", "arbitrary")).toBe(false);
    expect(allowedProjectsRoute("DELETE", "workflow-templates")).toBe(false);
  });

  it("allows calendars and their holidays, only by id and only with the right method", () => {
    expect(allowedHrmsRoute("GET", "calendars")).toBe(true);
    expect(allowedHrmsRoute("POST", "calendars")).toBe(true);
    expect(allowedHrmsRoute("PUT", `calendars/${ID}`)).toBe(true);
    expect(allowedHrmsRoute("POST", `calendars/${ID}/holidays`)).toBe(true);
    expect(allowedHrmsRoute("PUT", `holidays/${ID}`)).toBe(true);
    expect(allowedHrmsRoute("POST", `holidays/${ID}/remove`)).toBe(true);
    expect(allowedHrmsRoute("PUT", "calendars")).toBe(false);
    expect(allowedHrmsRoute("GET", `calendars/${ID}`)).toBe(false);
    expect(allowedHrmsRoute("POST", `calendars/${ID}`)).toBe(false);
    expect(allowedHrmsRoute("GET", `calendars/${ID}/holidays`)).toBe(false);
    expect(allowedHrmsRoute("POST", "holidays/not-an-id/remove")).toBe(false);
    expect(allowedHrmsRoute("DELETE", `holidays/${ID}`)).toBe(false);
  });

  it("allows crews, workers and crew days, only by id and only with the right method", () => {
    expect(allowedHrmsRoute("GET", "crews")).toBe(true);
    expect(allowedHrmsRoute("PUT", "crews")).toBe(true);
    expect(allowedHrmsRoute("PUT", "workers")).toBe(true);
    expect(allowedHrmsRoute("GET", "crew-days")).toBe(true);
    expect(allowedHrmsRoute("PUT", `crew-days/${ID}`)).toBe(true);
    expect(allowedHrmsRoute("POST", `crew-days/${ID}/submit`)).toBe(true);
    expect(allowedHrmsRoute("POST", `crew-days/${ID}/decision`)).toBe(true);
    for (const [method, path] of [
      ["POST", "crews"], ["DELETE", "crews"], ["GET", "workers"], ["POST", "workers"], ["GET", `crews/${ID}`], ["PUT", `workers/${ID}`],
      ["POST", "crew-days"], ["PUT", "crew-days"], ["GET", `crew-days/${ID}`], ["POST", `crew-days/${ID}`], ["PUT", `crew-days/${ID}/submit`],
      ["POST", "crew-days/not-an-id/submit"], ["POST", `crew-days/${ID}/approve`], ["DELETE", `crew-days/${ID}`],
    ]) expect(allowedHrmsRoute(method, path), `${method} ${path}`).toBe(false);
  });

  it("allows documents, site access, timesheets and payroll, only by id and only with the right method", () => {
    for (const [method, path] of [
      ["GET", "documents"], ["PUT", `documents/${ID}`], ["PUT", `documents/${ID}/file`], ["GET", `documents/${ID}/file`], ["POST", `documents/${ID}/remove`],
      ["GET", "site-access"], ["POST", "site-access"], ["POST", `site-access/${ID}/remove`],
      ["GET", "time/mine"], ["PUT", "time/weeks/2026-09-21"], ["POST", `time/${ID}/submit`], ["POST", `time/${ID}/decision`], ["GET", "time/team"], ["GET", "time/project"],
      ["GET", "time/utilisation"], ["GET", "payroll"], ["GET", "payroll/export"],
    ]) expect(allowedHrmsRoute(method, path), `${method} ${path}`).toBe(true);
    for (const [method, path] of [
      ["POST", "documents"], ["PUT", "documents"], ["DELETE", `documents/${ID}`], ["POST", `documents/${ID}/file`], ["GET", `documents/${ID}`],
      ["PUT", "site-access"], ["GET", `site-access/${ID}`], ["DELETE", `site-access/${ID}`],
      ["PUT", "time/weeks/next-week"], ["PUT", "time/weeks/2026-9-1"], ["GET", "time/weeks/2026-09-21"], ["POST", "time/mine"], ["POST", `time/${ID}/approve`], ["GET", "time/everyone"],
      ["POST", "payroll"], ["GET", "payroll/run"], ["PUT", "payroll/export"],
    ]) expect(allowedHrmsRoute(method, path), `${method} ${path}`).toBe(false);
  });

  it("takes files only where they belong, each in its own field and size", () => {
    expect(hrmsUpload(`captures/${ID}/photo`)).toEqual({ path: expect.any(RegExp), field: "photo", maxBytes: 6 * 1024 * 1024 });
    expect(hrmsUpload(`documents/${ID}/file`)).toEqual({ path: expect.any(RegExp), field: "file", maxBytes: 10 * 1024 * 1024 });
    for (const path of ["documents", `documents/${ID}`, "crews", `crew-days/${ID}`]) expect(hrmsUpload(path)).toBeNull();
    for (const path of [`captures/${ID}/photo`, `documents/${ID}/file`, "attendance/export", "payroll/export"]) expect(streamedHrmsRoute(path)).toBe(true);
    for (const path of ["payroll", "documents", "attendance/history"]) expect(streamedHrmsRoute(path)).toBe(false);
  });

  it("serves the work contexts and workplaces from projects, not the retired assignment and site views", () => {
    expect(allowedProjectsRoute("GET", "")).toBe(true);
    expect(allowedProjectsRoute("GET", "locations")).toBe(true);
    expect(allowedProjectsRoute("PUT", "locations")).toBe(true);
    for (const path of ["assignments", "attendance"]) expect(allowedProjectsRoute("GET", path)).toBe(false);
    expect(allowedProjectsRoute("PUT", "assignments")).toBe(false);
  });

  it("keeps workspace scope and employee calendar dates explicit", () => {
    expect(hrmsUrl("abc", "attendance/history?from=2026-09-01")).toBe("/api/workspace/hrms/attendance/history?from=2026-09-01&workspaceId=abc");
    expect(hrmsUrl("abc", "", "projects")).toBe("/api/workspace/projects?workspaceId=abc");
    expect(localDay("Asia/Kolkata", new Date("2026-09-06T20:00:00Z"))).toBe("2026-09-07");
  });

  it("turns a wall-clock time on a date into its instant in the person's time zone, and back", () => {
    expect(zonedInstant("2026-09-07", "09:30", "Asia/Kolkata").toISOString()).toBe("2026-09-07T04:00:00.000Z");
    expect(zonedInstant("2026-03-29", "09:00", "Europe/London").toISOString()).toBe("2026-03-29T08:00:00.000Z");
    expect(zonedInstant("2026-03-28", "09:00", "Europe/London").toISOString()).toBe("2026-03-28T09:00:00.000Z");
    expect(wallTime("2026-09-07T04:00:00.000Z", "Asia/Kolkata")).toBe("09:30");
  });

  it("links each People tab and what it opens", () => {
    expect(hrmsHref("attendance")).toBe("/workspace/hrms");
    expect(hrmsHref("attendance", { day: "2026-09-07" })).toBe("/workspace/hrms?day=2026-09-07");
    expect(hrmsHref("team", { leave: ID, review: null })).toBe(`/workspace/hrms/team?leave=${ID}`);
    expect(hrmsHref("crews", { crewDay: ID })).toBe(`/workspace/hrms/crews?crewDay=${ID}`);
    expect(hrmsHref("documents", { document: ID })).toBe(`/workspace/hrms/documents?document=${ID}`);
    expect(hrmsHref("time", { week: "2026-09-21" })).toBe("/workspace/hrms/time?week=2026-09-21");
  });
});
