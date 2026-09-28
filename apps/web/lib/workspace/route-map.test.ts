import { describe, expect, it } from "vitest";
import { resolveWorkspaceRoute } from "./route-map";

const route = (path: string, query = "") => resolveWorkspaceRoute(path, new URLSearchParams(query));
const crumbs = (path: string, query = "") => {
  const resolved = route(path, query);
  return [...resolved.trail.map((item) => item.label), resolved.label].join(" › ");
};

describe("workspace route map", () => {
  it("names Finance on its own, never under Projects or Settings", () => {
    for (const path of ["/workspace/finance", "/workspace/finance/payments", "/workspace/finance/suppliers/vendor-1"]) {
      expect(crumbs(path)).toBe("Finance");
      expect(route(path)).toMatchObject({ nav: "finance", settings: false });
    }
  });

  it("puts the directory, teams, roles and attendance in People, not in Settings", () => {
    expect(crumbs("/workspace/members")).toBe("People");
    expect(route("/workspace/members")).toMatchObject({ nav: "team", settings: false });
    expect(crumbs("/workspace/teams")).toBe("People › Teams");
    expect(crumbs("/workspace/roles")).toBe("People › Roles & permissions");
    expect(crumbs("/workspace/hrms")).toBe("People › Attendance");
    for (const path of ["/workspace/teams", "/workspace/roles", "/workspace/hrms", "/workspace/hrms/leave"]) expect(route(path)).toMatchObject({ nav: "team", settings: false });
    expect(crumbs("/workspace/settings/audit-logs")).toBe("Settings › Audit history");
  });

  it("treats Clients and Calendar as top-level destinations", () => {
    expect(crumbs("/workspace/crm/customers")).toBe("Clients");
    expect(crumbs("/workspace/projects/clients")).toBe("Clients");
    expect(route("/workspace/crm/customers").nav).toBe("clients");
    expect(crumbs("/workspace/crm/follow-ups", "view=schedule")).toBe("Calendar");
    expect(route("/workspace/crm/follow-ups", "view=schedule").nav).toBe("daily-follow-ups");
  });

  it("names Sales sections after the tab the person is on", () => {
    expect(crumbs("/workspace/crm/leads")).toBe("Sales › Enquiries");
    expect(crumbs("/workspace/crm/leads", "section=sources")).toBe("Sales › Campaigns");
    expect(crumbs("/workspace/crm/leads", "section=sla")).toBe("Sales › Settings");
    expect(route("/workspace/crm/leads", "section=sla")).toMatchObject({ nav: "sales", settings: false });
    expect(crumbs("/workspace/crm/opportunities")).toBe("Sales › Pipeline");
  });

  it("only lights the Settings gear on Settings pages", () => {
    for (const path of ["/workspace", "/workspace/tasks", "/workspace/approvals", "/workspace/catalogs", "/workspace/gallery", "/workspace/hrms", "/workspace/purchasing"]) {
      expect(route(path).settings, path).toBe(false);
    }
    expect(route("/workspace/company").settings).toBe(true);
    expect(route("/workspace/integrations")).toMatchObject({ settings: true, nav: "integrations" });
  });

  it("shows Home's tabs as Home and records under their module", () => {
    expect(route("/workspace/tasks")).toMatchObject({ homeTab: true, nav: "home", label: "Tasks" });
    expect(route("/workspace/crm/follow-ups", "view=activity")).toMatchObject({ homeTab: true, nav: "home" });
    expect(route("/workspace/projects/12345678-1234-4234-8234-123456789abc/scope")).toMatchObject({ record: true, nav: "projects" });
    expect(route("/workspace/pre-projects/cases/12345678-1234-4234-8234-123456789abc/quotations")).toMatchObject({ record: true, nav: "planning" });
    expect(crumbs("/workspace/hrms/leave")).toBe("People › Leave");
  });
});
