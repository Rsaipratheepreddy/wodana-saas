import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

vi.mock("../leads/lead-options", () => ({ loadLeadOptions: vi.fn(), validateLeadOptions: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../leads/intake-rules", () => ({
  assertCustomerType: vi.fn().mockResolvedValue(undefined),
  assertSourceAllowed: vi.fn().mockResolvedValue(undefined),
  resolveReferral: vi.fn().mockResolvedValue(null),
}));

import { CrmIntakeService } from "./crm-intake.service";

const input = (assignment: Record<string, unknown>) => ({ source: "company", channel: "call", intakeMethod: "manual", party: { displayName: "Asha", mobile: "+971501234567" }, serviceType: "design", details: { emirate: "dubai" }, originalPayload: {}, assignment });

function service({ canAssign, ownMembership }: { canAssign: boolean; ownMembership: string }) {
  const query = vi.fn(async (sql: string, params: unknown[]) => sql.includes("FROM workspace_memberships") && params[1] === ownMembership ? { rows: [{ present: 1 }], rowCount: 1 } : { rows: [], rowCount: 0 });
  const access = {
    withPermission: vi.fn(async (_actor, _workspace, _permission, work) => work({ query }, { userId: "user" })),
    hasPermission: vi.fn().mockResolvedValue(canAssign),
  };
  const instance = new CrmIntakeService({} as never, access as never, { record: vi.fn() } as never, {} as never);
  const ingest = vi.spyOn(instance as never, "ingest" as never).mockResolvedValue({ status: "ready" } as never);
  return { instance, ingest, access };
}

describe("who a new enquiry can be given to (LF-1)", () => {
  it("lets a salesperson own what they bring in, and routing decide, without the assignment permission", async () => {
    const { instance, ingest, access } = service({ canAssign: false, ownMembership: "me" });
    await instance.createManual({} as never, "workspace", "key", undefined, input({ mode: "manual", ownerMembershipId: "me" }) as never);
    await instance.createManual({} as never, "workspace", "key-2", undefined, input({ mode: "automatic" }) as never);
    expect(ingest).toHaveBeenCalledTimes(2);
    expect(access.hasPermission).not.toHaveBeenCalled();
  });

  it("needs the assignment permission to give it to someone else", async () => {
    const { instance, ingest } = service({ canAssign: false, ownMembership: "me" });
    await expect(instance.createManual({} as never, "workspace", "key", undefined, input({ mode: "manual", ownerMembershipId: "zaid" }) as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(ingest).not.toHaveBeenCalled();
    const manager = service({ canAssign: true, ownMembership: "me" });
    await manager.instance.createManual({} as never, "workspace", "key", undefined, input({ mode: "manual", ownerMembershipId: "zaid" }) as never);
    expect(manager.ingest).toHaveBeenCalledOnce();
  });
});
