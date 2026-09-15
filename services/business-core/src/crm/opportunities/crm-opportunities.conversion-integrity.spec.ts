import { describe, expect, it, vi } from "vitest";
import { canonicalHash } from "../shared/crm-types";
import { CrmOpportunitiesService } from "./crm-opportunities.service";

const input = {
  leadVersion: 4,
  partyId: "party",
  pipelineId: "pipeline",
  title: "Client — interior project",
  nextActionAt: "2026-09-20T09:00:00.000Z",
};

function setup(query: ReturnType<typeof vi.fn>) {
  const access = {
    withPermissions: vi.fn(async (_actor, _workspace, _permissions, work) => work({ query }, { userId: "user" })),
    hasPermission: vi.fn().mockResolvedValue(true),
  };
  const events = { record: vi.fn().mockResolvedValue(undefined) };
  const slas = { recordFirstResponse: vi.fn().mockResolvedValue(null) };
  return { service: new CrmOpportunitiesService(access as never, events as never, slas as never), access, events, slas };
}

describe("CRM lead conversion integrity", () => {
  it("returns the existing opportunity for an identical lost-response retry", async () => {
    const requestHash = canonicalHash({ leadId: "lead", ...input });
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT * FROM crm_leads")) return { rows: [{ id: "lead", version: 5 }], rowCount: 1 };
      if (sql.includes("SELECT id,conversion_request_hash")) return { rows: [{ id: "opportunity", conversion_request_hash: requestHash }], rowCount: 1 };
      if (sql.includes("FROM crm_opportunities opportunity")) return { rows: [{ id: "opportunity", lead_id: "lead", party_id: "party", status: "open", conversion_request_hash: requestHash }], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const { service } = setup(query);
    const replay = await service.qualifyLead({} as never, "workspace", "lead", input);
    expect(replay).toMatchObject({
      id: "opportunity", leadId: "lead", conversionReplay: true,
    });
    expect(replay).not.toHaveProperty("conversion_request_hash");
    expect(query.mock.calls.some(([sql]) => /^\s*(INSERT|UPDATE)\b/.test(sql))).toBe(false);
  });

  it("rejects a changed retry instead of silently reusing or duplicating a conversion", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT * FROM crm_leads")) return { rows: [{ id: "lead", version: 5 }], rowCount: 1 };
      if (sql.includes("SELECT id,conversion_request_hash")) return { rows: [{ id: "opportunity", conversion_request_hash: "0".repeat(64) }], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    });
    await expect(setup(query).service.qualifyLead({} as never, "workspace", "lead", input))
      .rejects.toThrow("already converted with different details");
    expect(query.mock.calls.some(([sql]) => /^\s*(INSERT|UPDATE)\b/.test(sql))).toBe(false);
  });

  it("copies frozen lead qualification evidence into a new linked opportunity", async () => {
    const evidence = { version: 1, leadId: "lead", selection: "global", form: { id: "form", version: 2 } };
    const evidenceHash = "a".repeat(64);
    const lead = {
      id: "lead", version: 4, status: "qualified", party_id: "party", enquiry_id: "enquiry",
      qualification_evidence: evidence, qualification_evidence_hash: evidenceHash,
    };
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes("SELECT * FROM crm_leads")) return { rows: [lead], rowCount: 1 };
      if (sql.includes("SELECT id,conversion_request_hash")) return { rows: [], rowCount: 0 };
      if (sql.includes("UPDATE crm_leads SET status='qualified'")) return { rows: [{ ...lead, version: 5 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const { service, events, slas } = setup(query);
    const create = vi.spyOn(service as never, "createInTransaction" as never).mockResolvedValue({
      id: "opportunity", party_id: "party", lead_id: "lead", status: "open",
    } as never);
    expect(await service.qualifyLead({} as never, "workspace", "lead", input)).toMatchObject({
      id: "opportunity", leadId: "lead",
    });
    expect(create).toHaveBeenCalledWith(expect.anything(), "workspace", { ...input, leadId: "lead" }, "user", true, {
      origin: "lead_qualification",
      requestHash: canonicalHash({ leadId: "lead", ...input }),
      qualificationEvidence: evidence,
      qualificationEvidenceHash: evidenceHash,
    });
    const leadUpdate = query.mock.calls.find(([sql]) => sql.includes("UPDATE crm_leads SET status='qualified'"));
    expect(leadUpdate?.[1]?.slice(3)).toEqual([evidence, evidenceHash, "user"]);
    expect(query.mock.calls.some(([sql]) => sql.includes("UPDATE crm_leads SET next_action_at=NULL"))).toBe(true);
    expect(slas.recordFirstResponse).toHaveBeenCalledOnce();
    expect(events.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "crm.lead.qualified.v1" }));
  });
});
