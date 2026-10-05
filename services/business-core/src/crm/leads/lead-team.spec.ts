import { describe, expect, it, vi } from "vitest";
import { carryTeamToOpportunity, teamRolesByEnquiryType, teamRolesForDefinition, writeLeadTeam } from "./lead-team";

const step = (check: string, role = "sales") => ({ key: check, name: check, role, check, column: "qualified" }) as never;

describe("which team roles an enquiry type asks for (PLM-100)", () => {
  it("asks for a designer when the type's steps hold an intro meeting, a design round or a measured site visit", () => {
    expect(teamRolesForDefinition({ steps: [step("contact_logged"), step("intro_meeting_completed")] })).toEqual(["designer"]);
    expect(teamRolesForDefinition({ steps: [step("package_chosen")] })).toEqual(["designer"]);
    expect(teamRolesForDefinition({ steps: [step("site_visit_recorded")] })).toEqual(["designer"]);
  });
  it("asks for the roles the steps are given to, branches included, and never for Sales (the owner)", () => {
    expect(teamRolesForDefinition({ steps: [step("quote_exists"), step("qs_approved", "quantity_surveyor")],
      branches: [{ key: "b", question: "subPath", after: "x", rejoin: "y", answers: [{ value: "bespoke", steps: [step("feasibility_confirmed", "factory_lead")] }] }] } as never))
      .toEqual(["quantity_surveyor", "factory_lead"]);
  });
  it("shows no team fields for a type without design work (a showroom sale), or for Not sure yet", () => {
    expect(teamRolesForDefinition({ steps: [step("contact_logged"), step("quote_exists"), step("payment_proof_attached")] })).toEqual([]);
    expect(teamRolesForDefinition(null)).toEqual([]);
  });
  it("maps each enquiry type to its roles through the latest version of its flow", async () => {
    const query = vi.fn(async () => ({ rowCount: 1, rows: [{ code: "design", definition: { steps: [step("intro_meeting_completed")] } }] }));
    const roles = await teamRolesByEnquiryType({ query } as never, "ws", [{ id: "full_id", flow: "design" }, { id: "furniture", flow: "showroom" }, { id: "not_sure" }]);
    expect(roles).toEqual({ full_id: ["designer"], furniture: [], not_sure: [] });
    expect((query.mock.calls[0] as unknown[])[1]).toEqual(["ws", ["design", "showroom"]]);
  });
  it("runs no query when no type has a flow", async () => {
    const query = vi.fn();
    expect(await teamRolesByEnquiryType({ query } as never, "ws", [{ id: "not_sure" }])).toEqual({ not_sure: [] });
    expect(query).not.toHaveBeenCalled();
  });
});

describe("tagging the team on an enquiry", () => {
  it("stores a member or Not applicable, one row per role, and clears a role when neither is given", async () => {
    const query = vi.fn(async (sql: string) => sql.includes("FROM workspace_memberships") ? { rowCount: 1, rows: [{}] } : { rowCount: 1, rows: [] });
    expect(await writeLeadTeam({ query } as never, "ws", "lead", [{ role: "designer", membershipId: "m1" }], "u1")).toEqual(["designer"]);
    const upsert = query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO crm_lead_team"));
    expect(upsert?.[1]).toEqual(["ws", "lead", "designer", "m1", false, "u1"]);
    await writeLeadTeam({ query } as never, "ws", "lead", [{ role: "designer", notApplicable: true }], "u1");
    expect(query.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO crm_lead_team")).at(-1)?.[1]).toEqual(["ws", "lead", "designer", null, true, "u1"]);
    await writeLeadTeam({ query } as never, "ws", "lead", [{ role: "designer" }], "u1");
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith("DELETE FROM crm_lead_team"))).toBe(true);
  });
  it("reports nothing changed when the choice is the same (idempotent)", async () => {
    const query = vi.fn(async (sql: string) => sql.includes("FROM workspace_memberships") ? { rowCount: 1, rows: [{}] } : { rowCount: 0, rows: [] });
    expect(await writeLeadTeam({ query } as never, "ws", "lead", [{ role: "designer", membershipId: "m1" }], "u1")).toEqual([]);
  });
  it("refuses an unknown role and an inactive member", async () => {
    const query = vi.fn(async () => ({ rowCount: 0, rows: [] }));
    await expect(writeLeadTeam({ query } as never, "ws", "lead", [{ role: "plumber", membershipId: "m1" }], "u1")).rejects.toThrow(/Unknown team role/);
    await expect(writeLeadTeam({ query } as never, "ws", "lead", [{ role: "designer", membershipId: "m1" }], "u1")).rejects.toThrow(/active team member/);
  });
  it("does nothing when the edit does not mention the team", async () => {
    const query = vi.fn();
    expect(await writeLeadTeam({ query } as never, "ws", "lead", undefined, "u1")).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("carrying the enquiry's team into the opportunity", () => {
  it("adds the team to the opportunity, makes the tagged designer its dedicated designer and records the change", async () => {
    const query = vi.fn(async (sql: string) => sql.includes("INSERT INTO crm_opportunity_designer (") ? { rowCount: 1, rows: [{ membershipId: "m1" }] } : { rowCount: 1, rows: [] });
    expect(await carryTeamToOpportunity({ query } as never, "ws", "lead", "opp", "u1")).toBe("m1");
    expect(query.mock.calls[0][0]).toContain("INSERT INTO crm_opportunity_team");
    expect(query.mock.calls[2][0]).toContain("crm_opportunity_designer_history");
    expect((query.mock.calls[2] as unknown[])[1]).toEqual(["ws", "opp", "m1", "u1"]);
  });
  it("leaves an opportunity that already has a designer, or an enquiry with none, alone", async () => {
    const query = vi.fn(async () => ({ rowCount: 0, rows: [] }));
    expect(await carryTeamToOpportunity({ query } as never, "ws", "lead", "opp", "u1")).toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
  });
});
