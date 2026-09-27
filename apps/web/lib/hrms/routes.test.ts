import { describe, it, expect } from "vitest";
import { allowedHrmsRoute, allowedProjectsRoute } from "./routes";
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
  });
});
