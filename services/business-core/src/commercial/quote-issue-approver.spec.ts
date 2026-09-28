import { describe, expect, it, vi } from "vitest";
import { CommercialService } from "./commercial.service";
import type { CommercialData, Quote } from "./commercial.types";

const quote = { id: "q", number: 1, kind: "quotation", round: "design", status: "internal_approved", title: "Design fee", currency: "AED",
  validUntil: "2999-12-31", discount: 0, taxRate: 0, terms: "", exclusions: "", requestIds: [], createdAt: "2026-09-27T00:00:00Z", total: 25000,
  paymentTerms: [{ id: "t", label: "Design deposit", percent: 100, trigger: "On acceptance" }],
  lines: [{ id: "l", room: "General", title: "Design fee", specification: "", material: "", finish: "", quantity: 1, unit: "package", unitCost: 12000, rate: 25000 }] } as unknown as Quote;

function setup(approvers: string[]) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("count(*)::int AS count FROM pre_project_brief_entries")) return { rows: [{ count: 0 }], rowCount: 1 };
    if (sql.includes("FROM client_portal_settings")) return { rows: [{ enabled: true, slug: "palm" }], rowCount: 1 };
    if (sql.includes("FROM client_portal_grants")) return { rows: approvers.map((id) => ({ id })), rowCount: approvers.length };
    return { rows: [], rowCount: 0 };
  });
  const access = {
    withPermissions: vi.fn(async (_actor, _workspace, _permissions, work) => work({ query }, { userId: "sales", displayName: "Sara" })),
    hasPermission: vi.fn().mockResolvedValue(true),
  };
  const service = new CommercialService(access as never, {} as never, {} as never, {} as never);
  const data = { revision: 4, quotes: [structuredClone(quote)], requests: [], agreement: null, payments: [], audit: [], release: null } as unknown as CommercialData;
  vi.spyOn(service, "caseRecord").mockResolvedValue({ status: "active" } as never);
  vi.spyOn(service, "load").mockResolvedValue(data);
  vi.spyOn(service, "persist").mockResolvedValue(undefined);
  return { service, data };
}
const issue = (service: CommercialService, extra: Record<string, unknown> = {}) =>
  service.command({} as never, "workspace", "case", { action: "issue", revision: 4, quoteId: "q", ...extra });

describe("sending a quote to the client", () => {
  it("goes to the case's only client approver without asking", async () => {
    const { service, data } = setup(["grant-1"]);
    await issue(service).catch(() => undefined);
    expect(data.quotes[0].approverId).toBe("grant-1");
  });

  it("says to add the client in the portal when there is no approver", async () => {
    const { service } = setup([]);
    await expect(issue(service)).rejects.toThrow("Add the client's decision-maker first.");
  });

  it("asks which approver when there are several", async () => {
    const { service } = setup(["grant-1", "grant-2"]);
    await expect(issue(service)).rejects.toThrow("Choose which client decision-maker receives this quote.");
  });

  it("refuses an approver who isn't active on this case", async () => {
    const { service } = setup(["grant-1"]);
    await expect(issue(service, { approverId: "someone-else" })).rejects.toThrow("Choose an active client approver.");
  });
});
