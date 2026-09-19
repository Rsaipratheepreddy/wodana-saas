import { describe, expect, it, vi } from "vitest";
import { BriefService, qualificationHandoffValues } from "./brief.service";

const evidence = {
  version: 1,
  leadId: "lead-1",
  answers: [
    { questionKey: "requirements", value: "Family living room and kitchen" },
    { questionKey: "budget", value: "250k–500k" },
    { questionKey: "timeline", value: "Before December" },
    { questionKey: "location", value: "Palm Jumeirah" },
    { questionKey: "decision_maker", value: "Amina and Omar" },
    { questionKey: "preferences", value: ["Warm oak", "Natural stone"] },
  ],
};

describe("pre-execution CRM qualification handoff", () => {
  it("normalizes the frozen evidence values used by discovery", () => {
    expect(qualificationHandoffValues(evidence)).toEqual({
      requirements: "Family living room and kitchen",
      budget: "250k–500k",
      timeline: "Before December",
      location: "Palm Jumeirah",
      decision_maker: "Amina and Omar",
      preferences: "Warm oak, Natural stone",
    });
    expect(qualificationHandoffValues(null)).toBeNull();
  });

  it("uses the opportunity's frozen snapshot instead of mutable lead answers", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM pre_project_cases c JOIN workspaces")) return { rows: [{ status: "active", description: "Original enquiry", amount: null, currencyCode: "AED", leadId: "lead-1", qualificationEvidence: evidence }], rowCount: 1 };
      if (sql.includes("FROM pre_project_briefs")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM crm_lead_qualification_values")) throw new Error("Live lead answers must not replace the frozen handoff");
      if (sql.includes("FROM pre_project_rooms") || sql.includes("FROM pre_project_brief_entries") || sql.includes("FROM pre_project_site_records")) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const access = {
      withPermission: vi.fn(async (_actor, _workspace, _permission, work) => work({ query }, { userId: "user-1" })),
      hasPermission: vi.fn().mockResolvedValue(true),
    };
    const service = new BriefService(access as never, {} as never, {} as never);
    const result = await service.get({} as never, "workspace", "case-1");
    expect(result.brief).toMatchObject({
      goals: "Family living room and kitchen",
      budget: "250k–500k",
      timeline: "Before December",
      location: "Palm Jumeirah",
      decisionMakers: "Amina and Omar",
      currencyCode: "AED",
    });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("crm_lead_qualification_values"))).toBe(false);
  });
});
