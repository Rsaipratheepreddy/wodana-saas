import { describe, expect, it, vi } from "vitest";
import { CrmLeadsService } from "./crm-leads.service";

describe("CRM lead qualification presentation", () => {
  it("presents the frozen decision snapshot without consulting a later active form", async () => {
    const evidence = {
      version: 1,
      leadId: "lead",
      serviceType: "interior_design",
      selection: "service_specific",
      form: { id: "original-form", code: "original", name: "Original form", serviceType: "interior_design", version: 2, questions: [] },
      answers: [],
      requiredKeys: [],
      evaluatedAt: "2026-09-15T08:00:00.000Z",
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT lead.*")) {
        return {
          rows: [{
            id: "lead", enquiry_id: "enquiry", party_id: "party", owner_membership_id: null, queue_id: null,
            status: "qualified", version: 5, source: "company", channel: "website",
            service_type: "interior_design", business_unit_id: null, preferred_locale: "en-AE",
            party_owner_membership_id: null, qualification_evidence: evidence,
            qualification_evidence_hash: "a".repeat(64),
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM crm_lead_qualification_values")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM crm_assignment_history")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM crm_sla_instances")) return { rows: [], rowCount: 0 };
      if (sql.includes("SELECT enquiry.id")) return { rows: [{ id: "enquiry", externalEventId: "lead-ad-42", correlationId: "correlation-42" }], rowCount: 1 };
      if (sql.includes("FROM crm_attribution_touches")) return { rows: [{ id: "touch", source: "instagram", medium: "shared_link", campaign: "summer" }], rowCount: 1 };
      if (sql.includes("FROM crm_identity_candidates candidate")) return { rows: [], rowCount: 0 };
      if (/workspace_sales_settings|crm_lead_team|crm_taxonomy_options|AND user_id = \$2 AND status = 'active' LIMIT 1/.test(sql)) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const access = {
      withPermission: vi.fn(async (_actor, _workspace, _permission, work) => work({ query }, { userId: "user" })),
      hasPermission: vi.fn(async (_client: unknown, _workspace: string, _user: string, code: string) => code === "crm.leads.view_all"),
    };
    const service = new CrmLeadsService({} as never, access as never, {} as never, {} as never);

    const result = await service.get({} as never, "workspace", "lead");

    expect(result.qualificationState).toEqual({
      ready: true,
      missingRequired: [],
      selection: "service_specific",
      form: evidence.form,
      frozen: true,
    });
    expect(result.enquiry).toMatchObject({
      id: "enquiry",
      externalEventId: "lead-ad-42",
      correlationId: "correlation-42",
      attribution: [{ id: "touch", source: "instagram", medium: "shared_link", campaign: "summer" }],
    });
    expect(query.mock.calls.some(([sql]) => sql.trim().startsWith("SELECT enquiry.service_type"))).toBe(false);
  });

  it("preserves a frozen no-form decision for a resolved enquiry type", async () => {
    const evidence = {
      version: 1,
      leadId: "lead",
      serviceType: "interior_design",
      selection: "none",
      form: null,
      answers: [],
      requiredKeys: [],
      evaluatedAt: "2026-09-18T08:00:00.000Z",
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT lead.*")) return { rows: [{
        id: "lead", enquiry_id: "enquiry", party_id: "party", owner_membership_id: null, queue_id: null,
        status: "qualified", version: 2, source: "shared_link", channel: "website", service_type: "interior_design",
        business_unit_id: null, preferred_locale: "en-AE", party_owner_membership_id: null,
        qualification_evidence: evidence, qualification_evidence_hash: "b".repeat(64),
      }], rowCount: 1 };
      if (sql.includes("FROM crm_lead_qualification_values") || sql.includes("FROM crm_assignment_history")
        || sql.includes("FROM crm_sla_instances") || sql.includes("FROM crm_attribution_touches")
        || sql.includes("FROM crm_identity_candidates candidate")) return { rows: [], rowCount: 0 };
      if (sql.includes("SELECT enquiry.id")) return { rows: [{ id: "enquiry" }], rowCount: 1 };
      if (/workspace_sales_settings|crm_lead_team|crm_taxonomy_options|AND user_id = \$2 AND status = 'active' LIMIT 1/.test(sql)) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const access = {
      withPermission: vi.fn(async (_actor, _workspace, _permission, work) => work({ query }, { userId: "user" })),
      hasPermission: vi.fn(async (_client: unknown, _workspace: string, _user: string, code: string) => code === "crm.leads.view_all"),
    };
    const service = new CrmLeadsService({} as never, access as never, {} as never, {} as never);

    await expect(service.get({} as never, "workspace", "lead")).resolves.toMatchObject({
      qualificationState: { ready: true, missingRequired: [], selection: "none", form: null, frozen: true },
    });
    expect(query.mock.calls.some(([sql]) => sql.trim().startsWith("SELECT enquiry.service_type"))).toBe(false);
  });
  it("names the owner on a single enquiry, so a role without the team list still sees who owns it", async () => {
    const evidence = { version: 1, leadId: "lead", serviceType: "interior_design", selection: "none", form: null, answers: [], requiredKeys: [], evaluatedAt: "2026-09-18T08:00:00.000Z" };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT lead.*")) return { rows: [{
        id: "lead", enquiry_id: "enquiry", party_id: "party", owner_membership_id: "membership", queue_id: null,
        status: "qualified", version: 2, source: "company", channel: "call", service_type: "interior_design",
        business_unit_id: null, preferred_locale: "en-AE", party_owner_membership_id: null,
        qualification_evidence: evidence, qualification_evidence_hash: "c".repeat(64),
      }], rowCount: 1 };
      if (sql.includes("person.display_name AS \"ownerName\"")) return { rows: [{ ownerName: "Sara Sales" }], rowCount: 1 };
      if (sql.includes("FROM crm_lead_qualification_values") || sql.includes("FROM crm_assignment_history")
        || sql.includes("FROM crm_sla_instances") || sql.includes("FROM crm_attribution_touches")
        || sql.includes("FROM crm_identity_candidates candidate")) return { rows: [], rowCount: 0 };
      if (sql.includes("SELECT enquiry.id")) return { rows: [{ id: "enquiry" }], rowCount: 1 };
      if (/workspace_sales_settings|crm_lead_team|crm_taxonomy_options|AND user_id = \$2 AND status = 'active' LIMIT 1/.test(sql)) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const access = { withPermission: vi.fn(async (_actor, _workspace, _permission, work) => work({ query }, { userId: "user" })), hasPermission: vi.fn(async (_client: unknown, _workspace: string, _user: string, code: string) => code === "crm.leads.view_all") };
    const service = new CrmLeadsService({} as never, access as never, {} as never, {} as never);
    const result = await service.get({} as never, "workspace", "lead");
    expect(result).toMatchObject({ ownerMembershipId: "membership", ownerName: "Sara Sales" });
  });
});
