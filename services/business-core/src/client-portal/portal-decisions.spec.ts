import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import type { CommercialData } from "../commercial/commercial.types";
import type { PortalContact } from "./portal-auth";
import { comment, noticeClientMessage, raiseRequest, type DecisionContext } from "./portal-decisions";
import type { PortalSettings } from "./portal-settings";

const CASE = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
let projectStarted = false;

vi.mock("./portal-read", () => ({
  readCase: vi.fn(async () => ({ caseId: CASE, caseStatus: "active", title: "Villa 402", projectId: projectStarted ? PROJECT : null, projectName: projectStarted ? "Villa 402" : null,
    reference: projectStarted ? "PRJ-7" : null, projectStatus: projectStarted ? "active" : null, startedAt: null, startDate: null, promiseDate: null, currency: "USD" })),
}));
vi.mock("./portal-settings", async (importOriginal) => ({ ...(await importOriginal<typeof import("./portal-settings")>()), readProjectAccess: vi.fn(async () => null) }));

/** A database that answers the case facts, the project team and the notification tables, with the same unique key as the real one. */
function database() {
  const sent = new Set<string>();
  const notices: Array<{ userId: string; code: string; subject: string; body: string; deepLink: string; key: string }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM pre_project_cases")) return { rowCount: 1, rows: [{ clientName: "Maya Client", ownerUserId: "sales", engagementOwnerUserId: "designer" }] };
    if (sql.includes("FROM project_assignments")) return { rowCount: 2, rows: [{ userId: "manager" }, { userId: "designer" }] };
    if (sql.includes("FROM notification_preferences")) return { rowCount: 0, rows: [] };
    if (sql.includes("FROM notification_templates")) return { rowCount: 1, rows: [{ id: "template", subject: "{{actor}} on {{title}}", body: "{{request}}: {{note}}" }] };
    if (sql.includes("INSERT INTO notifications")) {
      const key = String(params[7]);
      if (sent.has(key)) return { rowCount: 0, rows: [] };
      sent.add(key);
      notices.push({ userId: String(params[2]), code: String(params[3]), subject: String(params[4]), body: String(params[5]), deepLink: String(params[6]), key });
      return { rowCount: 1, rows: [] };
    }
    return { rowCount: 0, rows: [] };
  });
  return { db: { query } as unknown as PoolClient, notices };
}

function context(db: PoolClient, data: CommercialData): DecisionContext {
  const settings = { workspaceId: "w", slug: "s", enabled: true, version: 1, sections: { progress: true, decisions: true, payments: true, documents: true, warranty: true, messages: true },
    progress: { stageNames: true, dates: true, updates: true, photos: true }, invoiceAmounts: true, welcomeTitle: "", welcomeText: "", support: { phone: "", email: "", whatsapp: "" } } as PortalSettings;
  const contact = { phone: "+12025550123", grants: [{ id: "g1", caseId: CASE, name: "Maya", role: "viewer", email: null, confirmed: true }] } as unknown as PortalContact;
  return { db, workspaceId: "w", contact, settings, today: "2026-09-27", verify: async () => true, definitions: {} as DecisionContext["definitions"],
    commercial: { load: async () => data, persist: async () => undefined } };
}

const emptyCase = (): CommercialData => ({ revision: 1, quotes: [], requests: [], payments: [] } as unknown as CommercialData);

describe("client messages reach the team", () => {
  it("a new request tells the case owner and the engagement owner once each, with a link to the thread", async () => {
    projectStarted = false;
    const { db, notices } = database();
    const data = emptyCase();
    const result = await raiseRequest(context(db, data), { caseId: CASE, title: "Paint", detail: "Which white did you mean?" });
    expect(data.requests).toHaveLength(1);
    expect(notices.map((notice) => notice.userId).sort()).toEqual(["designer", "sales"]);
    for (const notice of notices) {
      expect(notice.code).toBe("request.client_raised");
      expect(notice.subject).toBe("Maya on Villa 402");
      expect(notice.body).toBe("CR-001 · Paint: Which white did you mean?");
      expect(notice.deepLink).toBe(`/workspace/pre-projects/cases/${CASE}/variations?request=${result.requestId}`);
      expect(notice.key).toBe(`request.client_raised:${result.requestId}:${notice.userId}`);
    }
  });

  it("a reply on a started project also tells the project managers, without telling anyone twice", async () => {
    projectStarted = true;
    const { db, notices } = database();
    const data = emptyCase();
    data.requests.push({ id: "33333333-3333-4333-8333-333333333333", number: 2, title: "Sockets", detail: "One more?", status: "open", owner: "", dueDate: "", resolution: "", createdAt: "", comments: [] });
    await comment(context(db, data), { caseId: CASE, requestId: "33333333-3333-4333-8333-333333333333", text: "Yes, by the bed." });
    const commentId = data.requests[0].comments[0].id;
    expect(data.requests[0].comments[0]).toMatchObject({ author: "Maya", text: "Yes, by the bed.", visibility: "client", fromClient: true });
    expect(notices.map((notice) => notice.userId).sort()).toEqual(["designer", "manager", "sales"]);
    expect(notices[0]).toMatchObject({ code: "request.client_replied", subject: "Maya on PRJ-7 · Villa 402", body: "CR-002 · Sockets: Yes, by the bed.",
      deepLink: `/workspace/pre-projects/cases/${CASE}/variations?request=33333333-3333-4333-8333-333333333333`, key: `request.client_replied:${commentId}:${notices[0].userId}` });
    projectStarted = false;
  });

  it("the same message keyed again sends nothing more", async () => {
    const { db, notices } = database();
    const row = { caseId: CASE, projectId: null, title: "Villa 402", reference: null, projectName: null };
    const request = { id: "44444444-4444-4444-8444-444444444444", number: 3, title: "Lighting" };
    await noticeClientMessage(db, "w", row, { code: "request.client_replied", actor: "Maya", request, note: "Warmer, please.", key: "comment-1" });
    await noticeClientMessage(db, "w", row, { code: "request.client_replied", actor: "Maya", request, note: "Warmer, please.", key: "comment-1" });
    expect(notices).toHaveLength(2);
    expect(notices.map((notice) => notice.userId).sort()).toEqual(["designer", "sales"]);
  });

  it("a request on a hidden messages section is refused before anything is saved or sent", async () => {
    const { db, notices } = database();
    const ctx = context(db, emptyCase());
    ctx.settings = { ...ctx.settings, sections: { ...ctx.settings.sections, messages: false } };
    await expect(raiseRequest(ctx, { caseId: CASE, title: "Paint", detail: "Which white?" })).rejects.toThrow(/isn't shared/);
    expect(notices).toHaveLength(0);
  });
});
