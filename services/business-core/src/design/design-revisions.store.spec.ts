import { beforeEach, describe, expect, it, vi } from "vitest";

const createChange = vi.fn();
const raiseProjectChange = vi.fn();
const projectForChanges = vi.fn();
const tellMembers = vi.fn();
const postJobEvent = vi.fn();
const recordAudit = vi.fn();
vi.mock("../change-requests/change-request.store", () => ({ createChange: (...args: unknown[]) => createChange(...args) }));
vi.mock("../change-requests/project-changes.store", () => ({
  projectForChanges: (...args: unknown[]) => projectForChanges(...args), raiseProjectChange: (...args: unknown[]) => raiseProjectChange(...args),
}));
vi.mock("../jobs/job-thread", () => ({ postJobEvent: (...args: unknown[]) => postJobEvent(...args) }));
vi.mock("../audit/record-audit", () => ({ recordAudit: (...args: unknown[]) => recordAudit(...args) }));
vi.mock("./design-journey.store", () => ({
  caseFacts: async () => ({ clientName: "The client", accountManagerId: "am-membership" }),
  leadDesigner: async () => "lead-membership",
  tellMembers: (...args: unknown[]) => tellMembers(...args),
}));

import { askedForChanges, assertRevisionCanStart, readStepRevisions } from "./design-revisions.store";

type Link = { stage: string; revision: number; changeRequestId: string; replaced: boolean };
type Change = { id: string; number: number; status: string };

/** A case on the records: its journey's free revisions, the client's asks per step, the links and their changes. */
function fakeDb(state: { included: number | null; journey?: boolean; asked: Record<string, number>; files?: Array<{ stage: string; asked: number }>; links: Link[]; changes: Change[] }) {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM pre_project_cases") && sql.includes("FOR UPDATE")) return { rows: [{}], rowCount: 1 };
    if (sql.includes("FROM workspace_memberships")) return { rows: params[1] === "am-membership" ? [{ userId: "am-user" }] : [], rowCount: 1 };
    if (sql.includes("FROM design_journeys")) return state.journey === false ? { rows: [], rowCount: 0 } : { rows: [{ included: state.included }], rowCount: 1 };
    if (sql.includes("FROM design_presentations")) return { rows: Object.entries(state.asked).map(([stage, asked]) => ({ stage, asked })), rowCount: 0 };
    if (sql.includes("FROM pre_project_design_activity")) return { rows: state.files ?? [], rowCount: 0 };
    if (sql.includes("FROM design_extra_revisions link")) {
      const rows = state.links.filter((link) => !link.replaced && (params[2] === null || link.stage === params[2])).sort((a, b) => b.revision - a.revision)
        .filter((link, index, all) => all.findIndex((other) => other.stage === link.stage) === index)
        .map((link) => { const change = state.changes.find((item) => item.id === link.changeRequestId)!;
          return { stage: link.stage, revision: link.revision, changeRequestId: link.changeRequestId, number: change.number, status: change.status, projectId: null, quoteId: null, caseId: "case" }; });
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("UPDATE design_extra_revisions")) {
      for (const link of state.links) if (link.stage === params[2] && link.revision === params[3]) link.replaced = true;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO design_extra_revisions")) {
      state.links.push({ stage: params[3] as string, revision: params[4] as number, changeRequestId: params[6] as string, replaced: false });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected query: ${sql.slice(0, 80)}`);
  });
  return { query } as never;
}

beforeEach(() => {
  for (const mock of [createChange, raiseProjectChange, projectForChanges, tellMembers, postJobEvent, recordAudit]) mock.mockReset();
  projectForChanges.mockResolvedValue(null);
});

const drafted = (state: { changes: Change[] }) => createChange.mockImplementation(async (_db: unknown, _ws: string, _case: string, input: { id: string; title: string }) => {
  const number = state.changes.length + 1;
  state.changes.push({ id: input.id, number, status: "draft" });
  return { replayed: false, change: { id: input.id, reference: `CR-${String(number).padStart(3, "0")}` } };
});

describe("free design revisions, then a chargeable change: the drafting rule", () => {
  it("keeps the first N asks on a step free: nothing is drafted", async () => {
    const state = { included: 2, asked: { concepts: 2 }, links: [], changes: [] };
    drafted(state);
    expect(await askedForChanges(fakeDb(state), "ws", "case", "concepts", { userId: "u1" })).toEqual({ kind: "free", revision: 2, included: 2 });
    expect(createChange).not.toHaveBeenCalled();
    expect(tellMembers).not.toHaveBeenCalled();
  });

  it("uses 2 free revisions when the package doesn't say", async () => {
    const state = { included: null, asked: { renders: 2 }, links: [], changes: [] };
    drafted(state);
    expect(await askedForChanges(fakeDb(state), "ws", "case", "renders", { userId: "u1" })).toMatchObject({ kind: "free", included: 2 });
    state.asked.renders = 3;
    expect(await askedForChanges(fakeDb(state), "ws", "case", "renders", { userId: "u1" })).toMatchObject({ kind: "extra", revision: 3, included: 2, drafted: true });
  });

  it("drafts one chargeable change for revision N+1, however often it is asked", async () => {
    const state = { included: 2, asked: { concepts: 3 }, links: [] as Link[], changes: [] as Change[] };
    drafted(state);
    const db = fakeDb(state);
    const first = await askedForChanges(db, "ws", "case", "concepts", { grantId: "g1", name: "The client" }, { note: "Lighter floors", source: "presentation:p3" });
    expect(first).toMatchObject({ kind: "extra", revision: 3, included: 2, reference: "CR-001", drafted: true });
    const again = await askedForChanges(db, "ws", "case", "concepts", { grantId: "g1", name: "The client" }, { note: "Lighter floors" });
    expect(again).toMatchObject({ kind: "extra", revision: 3, changeRequestId: (first as { changeRequestId: string }).changeRequestId, drafted: false });
    expect(createChange).toHaveBeenCalledTimes(1);
    // A draft with no price, titled after the step, raised by a team member (the Account Manager) since the client asked in the portal.
    const [, , caseId, input, actor] = createChange.mock.calls[0];
    expect(caseId).toBe("case");
    expect(input).toMatchObject({ title: "Extra revision: Concepts", description: "Lighter floors", kind: "addition" });
    expect(input).not.toHaveProperty("lines");
    expect(actor).toEqual({ userId: "am-user" });
    expect(state.links).toEqual([{ stage: "concepts", revision: 3, changeRequestId: input.id, replaced: false }]);
    // The lead designer and the Account Manager hear it in the app; the job's thread gets one line.
    expect(tellMembers).toHaveBeenCalledTimes(1);
    expect(tellMembers.mock.calls[0][2]).toEqual(["lead-membership", "am-membership"]);
    expect(tellMembers.mock.calls[0][3]).toBe("design.extra_revision");
    expect(tellMembers.mock.calls[0][7]).toBe(false);
    expect(postJobEvent).toHaveBeenCalledWith(expect.anything(), "ws", expect.objectContaining({ record: { type: "case", id: "case" }, code: "design_extra_revision", ref: input.id }));
    expect(recordAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "design.extra_revision_raised.v1", source: "client_portal" }));
  });

  it("the step waits until the change is approved, then the revision can start", async () => {
    const state = { included: 2, asked: { concepts: 3 }, links: [] as Link[], changes: [] as Change[] };
    drafted(state);
    const db = fakeDb(state);
    await askedForChanges(db, "ws", "case", "concepts", { userId: "u1" });
    expect((await readStepRevisions(db, "ws", "case"))?.concepts).toMatchObject({ used: 3, included: 2, waiting: true, extra: { reference: "CR-001", status: "draft", state: "waiting" } });
    await expect(assertRevisionCanStart(db, "ws", "case", "concepts")).rejects.toThrow("Waiting for the extra revision to be agreed");
    await assertRevisionCanStart(db, "ws", "case", "renders");
    state.changes[0].status = "with_client";
    await expect(assertRevisionCanStart(db, "ws", "case", "concepts")).rejects.toThrow(/extra revision/);
    state.changes[0].status = "approved";
    await assertRevisionCanStart(db, "ws", "case", "concepts");
    expect((await readStepRevisions(db, "ws", "case"))?.concepts).toMatchObject({ waiting: false, extra: { state: "agreed" } });
    // The next ask is another extra revision: a new draft, and the step waits again.
    state.asked.concepts = 4;
    expect(await askedForChanges(db, "ws", "case", "concepts", { userId: "u1" })).toMatchObject({ kind: "extra", revision: 4, reference: "CR-002", drafted: true });
    await expect(assertRevisionCanStart(db, "ws", "case", "concepts")).rejects.toThrow(/extra revision/);
  });

  it("the team drafts again only after the client declined (or the team withdrew) the change", async () => {
    const state = { included: 2, asked: { concepts: 3 }, links: [] as Link[], changes: [] as Change[] };
    drafted(state);
    const db = fakeDb(state);
    await askedForChanges(db, "ws", "case", "concepts", { userId: "u1" });
    expect(await askedForChanges(db, "ws", "case", "concepts", { userId: "u1" }, { redraft: true })).toMatchObject({ drafted: false, reference: "CR-001" });
    state.changes[0].status = "declined";
    expect(await askedForChanges(db, "ws", "case", "concepts", { userId: "u1" })).toMatchObject({ drafted: false, reference: "CR-001" });
    expect(await askedForChanges(db, "ws", "case", "concepts", { userId: "u1" }, { redraft: true })).toMatchObject({ drafted: true, reference: "CR-002" });
    expect(state.links.map((link) => [link.changeRequestId === state.changes[0].id ? "CR-001" : "CR-002", link.replaced])).toEqual([["CR-001", true], ["CR-002", false]]);
  });

  it("counts a file step by its most-asked file, and ignores steps without deliverables or a journey", async () => {
    const state = { included: 1, asked: {}, files: [{ stage: "space_planning", asked: 1 }, { stage: "space_planning", asked: 1 }], links: [] as Link[], changes: [] as Change[] };
    drafted(state);
    expect(await askedForChanges(fakeDb(state), "ws", "case", "space_planning", { userId: "u1" })).toMatchObject({ kind: "free", revision: 1 });
    state.files[1].asked = 2;
    expect(await askedForChanges(fakeDb(state), "ws", "case", "space_planning", { userId: "u1" })).toMatchObject({ kind: "extra", revision: 2 });
    expect(await askedForChanges(fakeDb(state), "ws", "case", "kickoff", { userId: "u1" })).toEqual({ kind: "none" });
    expect(await askedForChanges(fakeDb({ ...state, journey: false }), "ws", "case", "concepts", { userId: "u1" })).toEqual({ kind: "none" });
  });

  it("on a started project the extra revision is raised on the project's changes", async () => {
    const state = { included: 2, asked: { renders: 3 }, links: [] as Link[], changes: [] as Change[] };
    projectForChanges.mockResolvedValue("project-1");
    raiseProjectChange.mockImplementation(async (_db: unknown, _ws: string, _project: string, input: { id: string }) => {
      state.changes.push({ id: input.id, number: 1, status: "draft" });
      return { replayed: false, change: { id: input.id, reference: "CR-001" } };
    });
    expect(await askedForChanges(fakeDb(state), "ws", "case", "renders", { userId: "u1" })).toMatchObject({ kind: "extra", drafted: true });
    expect(createChange).not.toHaveBeenCalled();
    expect(raiseProjectChange.mock.calls[0][2]).toBe("project-1");
    expect(raiseProjectChange.mock.calls[0][3]).toMatchObject({ title: "Extra revision: Renders", reason: "client_request" });
    expect(tellMembers.mock.calls[0][5]).toMatch(/^\/workspace\/projects\/project-1\/changes\//);
  });
});
