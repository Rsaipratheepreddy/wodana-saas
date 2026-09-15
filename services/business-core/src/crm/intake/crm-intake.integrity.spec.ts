import { describe, expect, it, vi } from "vitest";
import { canonicalHash, stableHash } from "../shared/crm-types";
import { CrmIntakeService } from "./crm-intake.service";

const intake = (overrides: Record<string, unknown> = {}) => ({
  source: "website",
  channel: "form",
  intakeMethod: "manual",
  receivedAt: "2026-09-15T08:00:00.000Z",
  party: { displayName: "Asha Rao", email: "asha@example.com" },
  serviceType: "not_sure",
  originalPayload: { campaign: "autumn", nested: { b: 2, a: 1 } },
  ...overrides,
});

function service(query: ReturnType<typeof vi.fn>, events = { record: vi.fn().mockResolvedValue(undefined) }) {
  const access = {
    withPermission: vi.fn(async (_actor, _workspaceId, _permission, work) => work({ query }, { userId: "user" })),
  };
  const instance = new CrmIntakeService({} as never, access as never, events as never, {} as never);
  return { instance, access, events };
}

const candidate = (overrides: Record<string, unknown> = {}) => ({
  id: "candidate",
  workspace_id: "workspace",
  intake_event_id: "intake",
  candidate_party_id: "candidate-party",
  status: "pending",
  decision: null,
  resolved_party_id: null,
  version: 2,
  intake_status: "duplicate_candidate",
  correlation_id: "11111111-1111-4111-8111-111111111111",
  original_payload: {
    party: { displayName: "Asha Rao", email: "asha@example.com" },
    title: "New enquiry",
    serviceType: "not_sure",
  },
  source: "website",
  channel: "form",
  received_at: new Date("2026-09-15T08:00:00.000Z"),
  legal_entity_id: null,
  ...overrides,
});

describe("CRM intake idempotency integrity", () => {
  it("replays version-2 intake content independent of JSON key order", async () => {
    const reordered = {
      originalPayload: { nested: { a: 1, b: 2 }, campaign: "autumn" },
      serviceType: "not_sure",
      party: { email: "asha@example.com", displayName: "Asha Rao" },
      receivedAt: "2026-09-15T08:00:00.000Z",
      intakeMethod: "manual",
      channel: "form",
      source: "website",
    };
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes("SELECT id,payload_hash,payload_hash_version")) {
        return { rows: [{ id: "intake", payload_hash: canonicalHash(reordered), payload_hash_version: 2 }], rowCount: 1 };
      }
      if (sql.includes("SELECT intake.id AS")) return { rows: [{ intakeEventId: "intake", status: "ready" }], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql} ${params}`);
    });
    const { instance } = service(query);
    expect(await instance["ingest"](
      { query } as never, "workspace", "user", "user", "  request-key  ", undefined, intake() as never,
    )).toMatchObject({ intakeEventId: "intake", idempotentReplay: true });
    expect(query.mock.calls[0][1]).toEqual(["workspace", "request-key"]);
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO crm_intake_events"))).toBe(false);
  });

  it("keeps exact legacy hash replay compatibility and rejects changed content", async () => {
    const original = intake();
    const legacyQuery = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT id,payload_hash,payload_hash_version")) {
        return { rows: [{ id: "intake", payload_hash: stableHash(original), payload_hash_version: 1 }], rowCount: 1 };
      }
      return { rows: [{ intakeEventId: "intake", status: "ready" }], rowCount: 1 };
    });
    expect(await service(legacyQuery).instance["ingest"](
      { query: legacyQuery } as never, "workspace", null, "integration", "legacy-key", undefined, original as never,
    )).toMatchObject({ idempotentReplay: true });

    const changed = intake({ summary: "Changed" });
    const changedQuery = vi.fn(async () => ({
      rows: [{ id: "intake", payload_hash: stableHash(original), payload_hash_version: 1 }], rowCount: 1,
    }));
    await expect(service(changedQuery).instance["ingest"](
      { query: changedQuery } as never, "workspace", null, "integration", "legacy-key", undefined, changed as never,
    )).rejects.toThrow("different content");
  });

  it("stores canonical hash version 2 and sends ambiguous matches to review", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT id,payload_hash,payload_hash_version")) return { rows: [], rowCount: 0 };
      if (sql.includes("INSERT INTO crm_intake_events")) return { rows: [{ id: "intake" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const { instance, events } = service(query);
    vi.spyOn(instance as never, "identityMatches" as never).mockResolvedValue([
      { partyId: "party-1", strength: "exact", score: 1, reasons: ["verified_email"] },
      { partyId: "party-2", strength: "exact", score: 1, reasons: ["verified_phone"] },
    ] as never);
    const result = await instance["ingest"](
      { query } as never, "workspace", "user", "user", "key", undefined, intake() as never,
    );
    expect(result).toMatchObject({ status: "duplicate_candidate" });
    const inserted = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO crm_intake_events"));
    expect(inserted?.[0]).toContain("payload_hash_version");
    expect(inserted?.[1]?.[9]).toBe(canonicalHash(intake()));
    expect(query.mock.calls.filter(([sql]) => sql.includes("INSERT INTO crm_identity_candidates"))).toHaveLength(2);
    expect(events.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "crm.identity.review_required.v1" }));
  });

  it("rejects materially future-dated intake before creating a record", async () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-09-15T08:00:00.000Z").getTime());
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const { instance } = service(query);
    await expect(instance["ingest"](
      { query } as never, "workspace", "user", "user", "key", undefined,
      intake({ receivedAt: "2026-09-15T08:06:00.000Z" }) as never,
    )).rejects.toThrow("cannot be in the future");
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO crm_intake_events"))).toBe(false);
  });

  it("records the authoritative verified-contact resolution for one exact match", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT id,payload_hash,payload_hash_version")) return { rows: [], rowCount: 0 };
      if (sql.includes("INSERT INTO crm_intake_events")) return { rows: [{ id: "intake" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const { instance } = service(query);
    vi.spyOn(instance as never, "identityMatches" as never).mockResolvedValue([
      { partyId: "party", strength: "exact", score: 1, reasons: ["verified_email"] },
    ] as never);
    vi.spyOn(instance as never, "createReadyRecords" as never).mockResolvedValue({
      partyId: "party", enquiryId: "enquiry", leadId: "lead", reference: "ENQ-1",
    } as never);
    const resolved = vi.spyOn(instance as never, "resolveIntake" as never).mockResolvedValue({ version: 2 } as never);
    expect(await instance["ingest"](
      { query } as never, "workspace", "user", "user", "key", undefined, intake() as never,
    )).toMatchObject({ status: "ready", resolutionType: "verified_contact", matchedExistingParty: true });
    expect(resolved).toHaveBeenCalledWith(expect.anything(), "workspace", expect.objectContaining({
      expectedStatus: "processing", resolutionType: "verified_contact", partyId: "party",
      evidence: { matchStrength: "exact", reasons: ["verified_email"] },
    }));
  });
});

describe("CRM duplicate resolution integrity", () => {
  it("attaches only to a currently active party and records the explicit final resolution", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM crm_identity_candidates candidate")) return { rows: [candidate()], rowCount: 1 };
      if (sql.includes("SELECT id FROM crm_parties")) return { rows: [{ id: "selected-party" }], rowCount: 1 };
      if (sql.includes("SET status=$1,decision=$2")) return { rows: [{ version: 3 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const { instance } = service(query);
    vi.spyOn(instance as never, "createReadyRecords" as never).mockResolvedValue({
      partyId: "selected-party", enquiryId: "enquiry", leadId: "lead", reference: "ENQ-1",
    } as never);
    const resolved = vi.spyOn(instance as never, "resolveIntake" as never).mockResolvedValue({ version: 3 } as never);
    expect(await instance.reviewDuplicate({} as never, "workspace", "candidate", {
      decision: "attach", partyId: "selected-party", version: 2, reason: "Verified with customer",
    })).toMatchObject({ decision: "attach", partyId: "selected-party", leadId: "lead" });

    const selected = query.mock.calls.find(([sql]) => sql.includes("SET status=$1,decision=$2"));
    expect(selected?.[1]?.slice(0, 5)).toEqual(["accepted", "attach", "selected-party", "user", "Verified with customer"]);
    expect(resolved).toHaveBeenCalledWith(expect.anything(), "workspace", expect.objectContaining({
      expectedStatus: "duplicate_candidate",
      resolutionType: "review_attach",
      partyId: "selected-party",
      evidence: expect.objectContaining({ candidateId: "candidate", decision: "attach" }),
    }));
  });

  it("rejects an inactive or merged party before creating business records", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM crm_identity_candidates candidate")) return { rows: [candidate()], rowCount: 1 };
      if (sql.includes("SELECT id FROM crm_parties")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    const { instance } = service(query);
    const create = vi.spyOn(instance as never, "createReadyRecords" as never);
    await expect(instance.reviewDuplicate({} as never, "workspace", "candidate", {
      decision: "attach", partyId: "candidate-party", version: 2,
    })).rejects.toThrow("no longer active");
    expect(create).not.toHaveBeenCalled();
  });

  it("requires a reason and rejects irrelevant party IDs for split/reject decisions", async () => {
    const query = vi.fn(async (sql: string) => sql.includes("FROM crm_identity_candidates candidate")
      ? { rows: [candidate()], rowCount: 1 }
      : { rows: [], rowCount: 1 });
    const { instance } = service(query);
    await expect(instance.reviewDuplicate({} as never, "workspace", "candidate", {
      decision: "create_new", version: 2,
    })).rejects.toThrow("review reason");
    await expect(instance.reviewDuplicate({} as never, "workspace", "candidate", {
      decision: "reject", partyId: "candidate-party", version: 2, reason: "Not the same person",
    })).rejects.toThrow("only allowed when attaching");
  });

  it("creates a separate identity only with an explicit audited split decision", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM crm_identity_candidates candidate")) return { rows: [candidate()], rowCount: 1 };
      if (sql.includes("SET status=$1,decision=$2")) return { rows: [{ version: 3 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const { instance } = service(query);
    vi.spyOn(instance as never, "createPartyFromPayload" as never).mockResolvedValue("new-party" as never);
    vi.spyOn(instance as never, "createReadyRecords" as never).mockResolvedValue({
      partyId: "new-party", enquiryId: "enquiry", leadId: "lead", reference: "ENQ-1",
    } as never);
    const resolved = vi.spyOn(instance as never, "resolveIntake" as never).mockResolvedValue({ version: 3 } as never);
    expect(await instance.reviewDuplicate({} as never, "workspace", "candidate", {
      decision: "create_new", version: 2, reason: "Shared office contact but a separate customer",
    })).toMatchObject({ decision: "create_new", partyId: "new-party" });
    const selected = query.mock.calls.find(([sql]) => sql.includes("SET status=$1,decision=$2"));
    expect(selected?.[1]?.slice(0, 5)).toEqual([
      "rejected", "create_new", "new-party", "user", "Shared office contact but a separate customer",
    ]);
    expect(resolved).toHaveBeenCalledWith(expect.anything(), "workspace", expect.objectContaining({
      resolutionType: "review_create_new", partyId: "new-party",
    }));
  });

  it("records a rejected candidate but refuses to strand an intake with no decision left", async () => {
    const events = { record: vi.fn().mockResolvedValue(undefined) };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM crm_identity_candidates candidate")) return { rows: [candidate()], rowCount: 1 };
      if (sql.includes("status='rejected',decision='reject'")) return { rows: [{ version: 3 }], rowCount: 1 };
      if (sql.includes("SELECT 1 FROM crm_identity_candidates")) return { rows: [{ exists: true }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const { instance } = service(query, events);
    expect(await instance.reviewDuplicate({} as never, "workspace", "candidate", {
      decision: "reject", version: 2, reason: "Different customer",
    })).toMatchObject({ decision: "reject", version: 3 });
    expect(events.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "crm.identity.candidate_rejected.v1",
      after: expect.objectContaining({ reason: "Different customer" }),
    }));

    const lastQuery = vi.fn(async (sql: string) => {
      if (sql.includes("FROM crm_identity_candidates candidate")) return { rows: [candidate()], rowCount: 1 };
      if (sql.includes("status='rejected',decision='reject'")) return { rows: [{ version: 3 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    await expect(service(lastQuery).instance.reviewDuplicate({} as never, "workspace", "candidate", {
      decision: "reject", version: 2, reason: "Different customer",
    })).rejects.toThrow("last possible match");
  });

  it("returns a safe replay for the same decision and rejects a changed retry", async () => {
    const resolvedCandidate = candidate({
      status: "accepted", decision: "attach", resolved_party_id: "selected-party", intake_status: "ready", version: 3,
    });
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM crm_identity_candidates candidate")) return { rows: [resolvedCandidate], rowCount: 1 };
      if (sql.includes("SELECT intake.id AS")) return { rows: [{ intakeEventId: "intake", status: "ready", partyId: "selected-party", leadId: "lead" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const { instance } = service(query);
    expect(await instance.reviewDuplicate({} as never, "workspace", "candidate", {
      decision: "attach", partyId: "selected-party", version: 2,
    })).toMatchObject({ reviewReplay: true, idempotentReplay: true, leadId: "lead" });
    await expect(instance.reviewDuplicate({} as never, "workspace", "candidate", {
      decision: "create_new", version: 2, reason: "Separate customer",
    })).rejects.toThrow("different decision");
    expect(query.mock.calls.some(([sql]) => sql.includes("UPDATE crm_identity_candidates"))).toBe(false);
  });

  it("rejects malformed list cursors before PostgreSQL casts them", async () => {
    const query = vi.fn();
    const { instance } = service(query);
    await expect(instance.list({} as never, "workspace", { cursor: "eyJ2YWx1ZSI6ImJhZCIsImlkIjoiYmFkIn0", limit: 25 }))
      .rejects.toThrow("Invalid page cursor");
    expect(query).not.toHaveBeenCalled();
  });

  it("writes a complete final resolution atomically and emits its audit event", async () => {
    const resolvedAt = new Date("2026-09-15T08:05:00.000Z");
    const query = vi.fn(async (sql: string) => sql.includes("UPDATE crm_intake_events")
      ? { rows: [{ version: 4, resolved_at: resolvedAt }], rowCount: 1 }
      : { rows: [], rowCount: 1 });
    const { instance, events } = service(query);
    await instance["resolveIntake"]({ query } as never, "workspace", {
      intakeEventId: "intake", expectedStatus: "duplicate_candidate", resolutionType: "review_attach",
      partyId: "party", actorUserId: "user", source: "user",
      correlationId: "11111111-1111-4111-8111-111111111111", evidence: { candidateId: "candidate" },
    });
    const update = query.mock.calls.find(([sql]) => sql.includes("UPDATE crm_intake_events"));
    expect(update?.[0]).toContain("resolution_type=$3,resolved_party_id=$4");
    expect(update?.[1]).toEqual([
      "workspace", "intake", "review_attach", "party", "user", { candidateId: "candidate" }, "duplicate_candidate",
    ]);
    expect(events.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "crm.identity.resolved.v1",
      after: expect.objectContaining({ resolvedPartyId: "party", resolvedAt }),
    }));
  });
});
