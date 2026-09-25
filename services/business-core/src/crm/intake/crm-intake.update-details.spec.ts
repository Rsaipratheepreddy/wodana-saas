import { describe, expect, it, vi } from "vitest";
import type { RequestActor } from "../../auth/actor";
import { CrmIntakeService } from "./crm-intake.service";

const workspaceId = "f81e8362-8d08-440a-89dd-06ec7a8b46e7";
const leadId = "62000000-0000-4000-8000-000000000001";
const actor: RequestActor = { subject: "local:sales", provider: "local", email: "sales@example.com", displayName: "Sales" };

function service(before: { source: string; channel: string }) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM crm_taxonomies")) return { rowCount: 0, rows: [] }; // default lead options
    if (sql.includes("FROM crm_leads lead")) return { rowCount: 1, rows: [{ version: 2, party_id: "p1", enquiry_id: "e1", title: "T", reference: "E-1", summary: "", service_type: "not_sure", details: {}, ...before }] };
    if (sql.includes("RETURNING version")) return { rowCount: 1, rows: [{ version: 3 }] };
    return { rowCount: 0, rows: [] };
  });
  const record = vi.fn();
  const access = { withPermission: vi.fn(async (_a, _w, _p, work) => work({ query }, { userId: "u1" })) };
  const intake = new CrmIntakeService({} as never, access as never, { record } as never, {} as never);
  return { intake, query, record };
}
const base = { version: 2, serviceType: "not_sure", party: { displayName: "Amira", mobile: "+971501234567" }, details: { emirate: "dubai" } };
const enquiryUpdate = (query: ReturnType<typeof vi.fn>) => query.mock.calls.find(([sql]) => String(sql).startsWith("UPDATE crm_enquiries"))?.[1];

describe("editing an enquiry's source and channel", () => {
  it("corrects the source and channel together and audits the change", async () => {
    const { intake, query, record } = service({ source: "company", channel: "call" });
    await intake.updateDetails(actor, workspaceId, leadId, { ...base, source: "referral", channel: "external", referral: { name: " Sara  Ali ", contact: "+971 50 111 2222" } } as never);
    expect(enquiryUpdate(query)?.slice(5)).toEqual(["referral", "external"]);
    const referral = query.mock.calls.find(([sql]) => String(sql).includes("SET referral_kind"))?.[1];
    expect(referral?.slice(2)).toEqual(["external", "Sara Ali", "+971 50 111 2222", null, null]);
    expect(record.mock.calls[0][1]).toMatchObject({ before: { source: "company", channel: "call" }, after: { source: "referral", channel: "external" } });
  });

  it("requires who referred a referral enquiry", async () => {
    const { intake } = service({ source: "company", channel: "call" });
    await expect(intake.updateDetails(actor, workspaceId, leadId, { ...base, source: "referral", channel: "external" } as never)).rejects.toThrow(/Referred by is required/);
  });

  it("rejects a channel that does not belong to the chosen source", async () => {
    const { intake } = service({ source: "company", channel: "call" });
    await expect(intake.updateDetails(actor, workspaceId, leadId, { ...base, source: "referral", channel: "call" } as never))
      .rejects.toThrow(/channel for this source/);
  });

  it("keeps an older source untouched when the edit does not change it", async () => {
    const { intake, query } = service({ source: "instagram", channel: "dm" });
    await intake.updateDetails(actor, workspaceId, leadId, base as never);
    expect(enquiryUpdate(query)?.slice(5)).toEqual(["instagram", "dm"]);
  });
});
