import { afterEach, describe, expect, it, vi } from "vitest";
import { autoAssignLeads } from "./auto-assign-leads";
import { leadsPageFixture } from "./leads";
afterEach(() => vi.unstubAllGlobals());
const makeLead = (id: string) => ({ ...leadsPageFixture.items[0], id, ownerMembershipId: null, ownerName: null });
const response = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data });
describe("Auto-assign unassigned leads", () => {
  it("collects every page before assignment and excludes assigned, converted and closed leads", async () => {
    const a = makeLead("a"), b = makeLead("b");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ data: [a, { ...a, id: "owned", ownerMembershipId: "manager" }, { ...a, id: "disqualified", status: "disqualified" }], nextCursor: "page2" }))
      .mockResolvedValueOnce(response({ data: [b, { ...a, id: "closed", status: "qualified" }, { ...a, id: "converted", isConverted: true }], nextCursor: null }))
      .mockResolvedValueOnce(response({ ...a, ownerMembershipId: "manager", version: a.version + 1 }))
      .mockResolvedValueOnce(response({ ...b, ownerMembershipId: "manager", version: b.version + 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const saved = vi.fn();
    const result = await autoAssignLeads("workspace", undefined, vi.fn(), saved);
    expect(result).toMatchObject({ total: 2, completed: 2, assigned: 2, remaining: [] });
    expect(fetchMock.mock.calls[1][0]).toContain("cursor=page2");
    expect(fetchMock.mock.calls[2][0]).toContain(`/leads/a/auto-assign?version=${a.version}`);
    expect(saved).toHaveBeenCalledTimes(2);
  });
  it("reports capacity and stale-version failures without claiming assignment succeeded", async () => {
    const a = makeLead("a"), b = makeLead("b");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ ...a, version: 2 })).mockResolvedValueOnce(response({ message: "Lead changed; reload and try again" }, 409)));
    const result = await autoAssignLeads("workspace", [a, b], vi.fn(), vi.fn());
    expect(result.assigned).toBe(0);
    expect(result.remaining).toEqual([{ id: "a", name: a.partyName, reason: "No available manager with remaining capacity." }, { id: "b", name: b.partyName, reason: "Lead changed; reload and try again" }]);
  });
  it("stops after permission errors and retains the unattempted leads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ message: "Not allowed" }, 403));
    vi.stubGlobal("fetch", fetchMock);
    const result = await autoAssignLeads("workspace", [makeLead("a"), makeLead("b")], vi.fn(), vi.fn());
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.remaining).toHaveLength(2);
    expect(result.completed).toBe(1);
  });
  it("does not mutate any leads if page loading fails", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ data: [makeLead("a")], nextCursor: "next" })).mockResolvedValueOnce(response({ message: "Unavailable" }, 503));
    vi.stubGlobal("fetch", fetchMock);
    await expect(autoAssignLeads("workspace", undefined, vi.fn(), vi.fn())).rejects.toThrow("Unavailable");
    expect(fetchMock.mock.calls.every(([, init]) => !init.method)).toBe(true);
  });
});
