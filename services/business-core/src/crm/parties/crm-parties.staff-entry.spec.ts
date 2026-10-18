import { describe, expect, it, vi } from "vitest";
import { CrmPartiesService } from "./crm-parties.service";

const workspaceId = "f81e8362-8d08-440a-89dd-06ec7a8b46e7";
const partyId = "62000000-0000-4000-8000-000000000001";

// Past the checks the service writes the party: stop there, so a test sees only what the checks refused.
function service(before: Record<string, unknown> = {}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("default_locale")) return { rowCount: 1, rows: [{ locale: "en-IN" }] };
    if (sql.startsWith("INSERT INTO crm_parties") || sql.startsWith("UPDATE crm_parties SET") || sql.startsWith("INSERT INTO crm_contact_points")) throw new Error("past the checks");
    if (sql.includes("FROM crm_contact_points") && sql.includes("FOR UPDATE")) return { rowCount: 1, rows: [{ version: 1, type: "phone", raw_value: "+919876543210", normalized_value: "+919876543210", country_code: "IN", status: "active", ...before }] };
    return { rowCount: 1, rows: [{}] };
  });
  const access = { withPermission: vi.fn(async (_a, _w, _p, work) => work({ query }, { userId: "u1" })), hasPermission: vi.fn(async () => true) };
  const parties = new CrmPartiesService(access as never, { record: vi.fn() } as never);
  vi.spyOn(parties as never, "partyAggregate" as never).mockResolvedValue({ status: "active", type: "person", displayName: "Ali 🙂", ...before } as never);
  vi.spyOn(parties as never, "requireParty" as never).mockResolvedValue({} as never);
  return parties;
}
const outcome = async (promise: Promise<unknown>) => {
  try { await promise; return "saved"; } catch (error) {
    if ((error as Error).message === "past the checks") return "saved";
    return (error as { getResponse?: () => { missing?: unknown } }).getResponse?.()?.missing ?? (error as Error).message;
  }
};
const actor = {} as never;

describe("a client typed by staff", () => {
  it("refuses a person's name with digits or symbols and accepts real names", async () => {
    expect(await outcome(service().create(actor, workspaceId, { type: "person", displayName: "Priya 2" } as never))).toEqual([{ key: "displayName", label: "Use letters and spaces only" }]);
    expect(await outcome(service().create(actor, workspaceId, { type: "person", displayName: "Mohammed Al-Suwaidi" } as never))).toBe("saved");
    // A company keeps its own name rules.
    expect(await outcome(service().create(actor, workspaceId, { type: "organization", displayName: "Studio 54 LLC" } as never))).toBe("saved");
  });

  it("refuses a phone that does not fit its country, using the workspace's region when none is chosen", async () => {
    expect(await outcome(service().create(actor, workspaceId, { type: "person", displayName: "Priya", contacts: [{ type: "phone", value: "98765" }] } as never)))
      .toEqual([{ key: "phone", label: "Enter a valid phone number for India" }]);
    expect(await outcome(service().create(actor, workspaceId, { type: "person", displayName: "Priya", contacts: [{ type: "phone", value: "+919876543210" }] } as never))).toBe("saved");
    expect(await outcome(service().addContact(actor, workspaceId, partyId, { type: "phone", value: "98765" } as never))).toEqual([{ key: "value", label: "Enter a valid phone number for India" }]);
    expect(await outcome(service().addContact(actor, workspaceId, partyId, { type: "phone", value: "9876543210" } as never))).toBe("saved");
  });

  it("checks a new name or phone only, keeping what came from a channel as it is", async () => {
    expect(await outcome(service().update(actor, workspaceId, partyId, { version: 1, displayName: "Ali 🙂" } as never))).toBe("saved");
    expect(await outcome(service().update(actor, workspaceId, partyId, { version: 1, displayName: "Ali #1" } as never))).toEqual([{ key: "displayName", label: "Use letters and spaces only" }]);
    expect(await outcome(service({ raw_value: "12345", normalized_value: null }).updateContact(actor, workspaceId, partyId, "c1", { version: 1, isPrimary: true } as never))).toBe("saved");
    expect(await outcome(service().updateContact(actor, workspaceId, partyId, "c1", { version: 1, value: "98765" } as never))).toEqual([{ key: "value", label: "Enter a valid phone number for India" }]);
  });
});
