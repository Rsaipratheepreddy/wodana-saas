import { describe, expect, it } from "vitest";
import {
  ROLE_PREVIEW_MINUTES,
  VIEW_AS_MAX_MINUTES,
  clampViewAsMinutes,
  leaveReasonsRemoved,
  planViewAsStart,
  privateNoticesRemoved,
  safeReturnPath,
  viewAsDurationMinutes,
  viewAsRouteLabel,
} from "./view-as.domain";

const owner = { userId: "owner", roles: ["owner"], canViewAs: true };
const admin = { userId: "admin", roles: ["administrator"], canViewAs: true };
const person = (roles: string[], extra: Partial<{ userId: string; active: boolean; operator: boolean }> = {}) =>
  ({ userId: "subject", active: true, operator: false, roles, ...extra });

describe("who may view as whom", () => {
  it("lets an owner or administrator view as an active team member for up to 30 minutes", () => {
    expect(planViewAsStart({ kind: "person", chained: false, viewer: owner, subject: person(["sales"]) })).toEqual({ minutes: VIEW_AS_MAX_MINUTES });
    expect(planViewAsStart({ kind: "person", chained: false, viewer: admin, subject: person(["administrator"]), minutes: 10 })).toEqual({ minutes: 10 });
    expect(planViewAsStart({ kind: "person", chained: false, viewer: owner, subject: person(["owner"]) })).toEqual({ minutes: 30 });
  });

  it("refuses an administrator viewing as an owner, and anyone without the permission", () => {
    expect(() => planViewAsStart({ kind: "person", chained: false, viewer: admin, subject: person(["owner", "sales"]) }))
      .toThrow(expect.objectContaining({ code: "view_as_owner_protected" }));
    expect(() => planViewAsStart({ kind: "person", chained: false, viewer: { ...admin, canViewAs: false }, subject: person(["sales"]) }))
      .toThrow(expect.objectContaining({ code: "view_as_not_allowed" }));
  });

  it("never views as oneself, a Wodana operator, someone inactive or not a member, and never from inside a view", () => {
    const refusal = (input: Parameters<typeof planViewAsStart>[0]) => {
      try { planViewAsStart(input); return null; } catch (error) { return (error as { code: string }).code; }
    };
    expect(refusal({ kind: "person", chained: false, viewer: owner, subject: person(["sales"], { userId: "owner" }) })).toBe("view_as_self");
    expect(refusal({ kind: "person", chained: false, viewer: owner, subject: person(["sales"], { operator: true }) })).toBe("view_as_operator");
    expect(refusal({ kind: "person", chained: false, viewer: owner, subject: person(["sales"], { active: false }) })).toBe("view_as_not_a_member");
    expect(refusal({ kind: "person", chained: false, viewer: owner, subject: null })).toBe("view_as_not_a_member");
    expect(refusal({ kind: "person", chained: true, viewer: owner, subject: person(["sales"]) })).toBe("view_as_chained");
  });

  it("previews a role for 15 minutes; only an owner previews the Owner role", () => {
    expect(planViewAsStart({ kind: "role", chained: false, viewer: admin, role: { code: "sales" } })).toEqual({ minutes: ROLE_PREVIEW_MINUTES });
    expect(planViewAsStart({ kind: "role", chained: false, viewer: owner, role: { code: "owner" } })).toEqual({ minutes: ROLE_PREVIEW_MINUTES });
    expect(() => planViewAsStart({ kind: "role", chained: false, viewer: admin, role: { code: "owner" } }))
      .toThrow(expect.objectContaining({ code: "view_as_owner_protected" }));
    expect(() => planViewAsStart({ kind: "role", chained: false, viewer: admin, role: null }))
      .toThrow(expect.objectContaining({ code: "view_as_role_not_found" }));
  });

  it("keeps the time box between 5 and 30 minutes", () => {
    expect([clampViewAsMinutes(undefined), clampViewAsMinutes(1), clampViewAsMinutes(90), clampViewAsMinutes(12.4)]).toEqual([30, 5, 30, 12]);
  });
});

describe("the view's trail and privacy", () => {
  const workspaceId = "00000000-0000-4000-8000-000000000001";

  it("keeps only in-app workspace paths to return to", () => {
    expect(safeReturnPath("/workspace/crm/leads?section=mine")).toBe("/workspace/crm/leads?section=mine");
    expect(safeReturnPath("/workspace")).toBe("/workspace");
    expect(safeReturnPath("https://evil.example/workspace")).toBeNull();
    expect(safeReturnPath("//evil.example")).toBeNull();
    expect(safeReturnPath("/workspace//evil")).toBeNull();
    expect(safeReturnPath("/login")).toBeNull();
    expect(safeReturnPath(42)).toBeNull();
  });

  it("records pages and API routes relative to the workspace, not its own session checks", () => {
    expect(viewAsRouteLabel({ method: "GET", path: "/api/v1/me", page: "/workspace/crm/leads?x=1", workspaceId })).toBe("page /workspace/crm/leads");
    expect(viewAsRouteLabel({ method: "GET", path: "/api/v1/me", workspaceId })).toBeNull();
    expect(viewAsRouteLabel({ method: "GET", path: `/api/v1/workspaces/${workspaceId}/crm/leads?page=2`, workspaceId })).toBe("GET /crm/leads");
    expect(viewAsRouteLabel({ method: "GET", path: `/api/v1/workspaces/${workspaceId}/view-as/settings`, workspaceId })).toBeNull();
  });

  it("leaves out notices about being viewed and the reasons in leave notices and requests", () => {
    const notices = privateNoticesRemoved([
      { eventType: "workspace.viewed_as", body: "Olivia viewed as you" },
      { eventType: "hrms.leave_approved", body: "Family wedding" },
      { eventType: "crm.lead_assigned", body: "New enquiry" },
    ]);
    expect(notices).toEqual([{ eventType: "hrms.leave_approved", body: "" }, { eventType: "crm.lead_assigned", body: "New enquiry" }]);
    expect(leaveReasonsRemoved([{ id: "1", reason: "Medical", decisionReason: "Ok", cancellationReason: null, status: "approved" }]))
      .toEqual([{ id: "1", reason: null, decisionReason: null, cancellationReason: null, status: "approved" }]);
  });

  it("counts at least a minute for a view", () => {
    expect(viewAsDurationMinutes(new Date("2026-09-29T10:00:00Z"), new Date("2026-09-29T10:00:20Z"))).toBe(1);
    expect(viewAsDurationMinutes(new Date("2026-09-29T10:00:00Z"), new Date("2026-09-29T10:12:40Z"))).toBe(13);
  });
});
