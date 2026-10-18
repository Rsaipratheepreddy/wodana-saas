import { describe, expect, it } from "vitest";
import { inboxScope, inboxViewer, jobLabel, jobTeamSql, loadInboxViewer, rankQuickReplies, suggestJob, viewSql, visibleSql } from "./inbox-visibility";

describe("inbox visibility (plan §5b)", () => {
  const viewer = (...codes: string[]) => inboxViewer(new Set(codes));

  it("reads the level from the permissions held, never from a role name: manage, team, own, else only the jobs", async () => {
    expect(viewer("crm.communications.view", "crm.communications.send").scope).toBe("own");
    expect(viewer("crm.communications.view", "crm.inbox.team").scope).toBe("team");
    expect(viewer("crm.inbox.manage").scope).toBe("manage");
    expect(viewer("crm.settings.manage").scope).toBe("manage");
    expect(viewer("crm.inbox.team", "crm.inbox.manage").scope).toBe("manage");
    // No inbox at all: a designer or a project manager reaches only the chats filed into their jobs.
    expect(viewer("projects.view", "crm.opportunities.view")).toEqual({ scope: "job", jobKinds: ["opportunity", "project"] });
    expect(viewer()).toEqual({ scope: "job", jobKinds: [] });
    const holding = (...codes: string[]) => async (code: string) => codes.includes(code);
    expect(await inboxScope(holding("crm.communications.view", "crm.inbox.team"))).toBe("team");
    expect(await loadInboxViewer(holding("crm.communications.view", "crm.leads.view"))).toEqual({ scope: "own", jobKinds: ["enquiry"] });
  });

  it("keeps manage unlimited and gives the job-only viewer nothing but their jobs' chats", () => {
    expect(visibleSql({ scope: "manage", jobKinds: [] }, "$2")).toBe("($2::uuid IS NULL OR TRUE)");
    expect(visibleSql({ scope: "job", jobKinds: [] }, "$2")).toBe("FALSE");
    const job = visibleSql({ scope: "job", jobKinds: ["project"] }, "$2");
    expect(job).toContain("conversation.job_id IS NOT NULL");
    expect(job).toContain("project_assignments job_assignment");
    expect(job).toContain("job_assignment.active");
    expect(job).not.toContain("crm_leads");
    expect(job).not.toContain("owner_membership_id IS NULL");
  });

  it("limits own and team to the unfiled intake, and opens a filed chat to the job's team only", () => {
    const own = visibleSql({ scope: "own", jobKinds: ["enquiry", "opportunity"] }, "$2");
    expect(own).toContain("(conversation.job_id IS NULL AND conversation.owner_membership_id = $2::uuid)");
    expect(own).toContain("job_lead.owner_membership_id = $2::uuid");
    expect(own).toContain("crm_opportunity_team job_member");
    expect(own).not.toContain("project_assignments");
    const team = visibleSql({ scope: "team", jobKinds: [] }, "$2", "chat");
    expect(team).toContain("chat.job_id IS NULL AND (chat.owner_membership_id IS NULL");
    expect(team).toContain("crm_effective_queue_members teammate");
    // In no queue at all, the whole inbox team is "my team".
    expect(team).toContain("NOT EXISTS (SELECT 1 FROM crm_effective_queue_members mine");
    expect(team.endsWith("OR FALSE)")).toBe(true);
  });

  it("names a job's team per kind", () => {
    expect(jobTeamSql([], "$3")).toBe("FALSE");
    expect(jobTeamSql(["enquiry"], "$3")).toMatch(/^\(conversation\.job_id IS NOT NULL AND \(\(conversation\.job_kind = 'enquiry'/);
    expect(jobTeamSql(["opportunity"], "$3", "c")).toContain("job_opportunity.owner_membership_id = $3::uuid OR EXISTS");
  });

  it("maps the chips to owner clauses inside the reach", () => {
    expect(viewSql("mine", "$2")).toBe("conversation.owner_membership_id = $2::uuid");
    expect(viewSql("unassigned", "$2")).toBe("conversation.owner_membership_id IS NULL");
    expect(viewSql("team", "$2")).toBe("conversation.owner_membership_id IS NOT NULL");
    expect(viewSql("all", "$2")).toBeNull();
    expect(viewSql(undefined, "$2")).toBeNull();
  });
});

describe("file into job", () => {
  it("proposes the contact's most specific live job: project, then opportunity, then enquiry", () => {
    expect(suggestJob([])).toBeNull();
    expect(suggestJob([{ kind: "enquiry", id: "e1", status: "disqualified" }, { kind: "opportunity", id: "o1", status: "lost" }])).toBeNull();
    expect(suggestJob([{ kind: "enquiry", id: "e1", status: "connected" }, { kind: "opportunity", id: "o1", status: "open" }])?.id).toBe("o1");
    expect(suggestJob([{ kind: "project", id: "p1", status: "active" }, { kind: "opportunity", id: "o1", status: "open" }])?.id).toBe("p1");
    expect(suggestJob([{ kind: "enquiry", id: "old", status: "new", updatedAt: "2026-01-01" }, { kind: "enquiry", id: "new", status: "new", updatedAt: "2026-02-01" }])?.id).toBe("new");
  });

  it("names a job by its reference and title", () => {
    expect(jobLabel({ reference: "E-1042", title: "Villa" })).toBe("E-1042 · Villa");
    expect(jobLabel({ reference: null, title: "Villa" })).toBe("Villa");
    expect(jobLabel({ reference: "", title: " " })).toBe("a job");
  });
});

describe("suggested replies", () => {
  const replies = [
    { shortcut: "address", body: "Our studio is on Beach Road, open 9 to 6." },
    { shortcut: "catalog", body: "Here is our catalogue of kitchens and wardrobes." },
    { shortcut: "invoice", body: "Invoice {{invoice.number}} is ready." },
    { shortcut: "welcome", body: "Thanks for writing to us. How can we help?" },
  ];
  it("ranks the quick replies by the words the client just used, then the ones that fit a new contact", () => {
    expect(rankQuickReplies(replies, { lastInbound: "Where is your studio? I want to see kitchens", hasEnquiry: true }).map((reply) => reply.shortcut)).toEqual(["address", "catalog"]);
    // A greeting alone says nothing: the door-step replies (address, catalogue, welcome) in the firm's own order.
    expect(rankQuickReplies(replies, { lastInbound: "Hi", hasEnquiry: false }).map((reply) => reply.shortcut)).toEqual(["address", "catalog", "welcome"]);
  });
  it("offers the firm's first three when the client has not written yet, and never an archived one", () => {
    expect(rankQuickReplies([...replies, { shortcut: "old", body: "Gone", status: "archived" }], { lastInbound: null, hasEnquiry: false }).map((reply) => reply.shortcut)).toEqual(["address", "catalog", "welcome"]);
  });
});
