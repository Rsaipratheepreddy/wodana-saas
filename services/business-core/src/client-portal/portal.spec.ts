import { describe, expect, it } from "vitest";
import type { ChangeRequest, Quote } from "../commercial/commercial.types";
import { maskEmail, mobileNumber, PortalCodes } from "./portal-auth";
import { portalQuote } from "./portal-quote";
import { portalRequest, portalTeam } from "./portal-read";
import { boqApplies, effectiveSections, jobCodes, type PortalSettings } from "./portal-settings";
import { portalBoq } from "./portal-boq";

const settings = (sections: Partial<PortalSettings["sections"]> = {}, boqEnquiryTypes: string[] = []): PortalSettings => ({
  workspaceId: "w", slug: "s", enabled: true, version: 1,
  sections: { progress: true, moodboard: true, decisions: true, payments: true, boq: true, documents: true, warranty: true, meetings: true, designs: true, messages: true, ...sections },
  progress: { stageNames: true, dates: true, updates: true, photos: true }, invoiceAmounts: true, boqEnquiryTypes, welcomeTitle: "", welcomeText: "", support: { phone: "", email: "", whatsapp: "" },
});

describe("client portal rules", () => {
  it("shows a project the workspace's sections, narrowed by the project, and nothing while it's paused", () => {
    expect(effectiveSections(settings({ payments: false }), null)).toMatchObject({ progress: true, payments: false });
    expect(effectiveSections(settings(), { sections: ["progress", "payments"], paused: false, pausedAt: null, version: 1 }))
      .toEqual({ progress: true, moodboard: false, decisions: false, payments: true, boq: false, documents: false, warranty: false, meetings: false, designs: false, messages: false });
    expect(Object.values(effectiveSections(settings(), { sections: null, paused: true, pausedAt: "2026-09-27", version: 1 }))).toEqual(Array(10).fill(false));
  });

  it("PLM-170: shows the bill of quantities only for the kinds of job the firm lists (its enquiry type or its order path), every job without a list", () => {
    const palm = settings({}, ["full_fit_out", "bespoke"]);
    expect(boqApplies(palm, { enquiryType: "full_fit_out", furniturePath: null })).toBe(true);
    expect(boqApplies(palm, { enquiryType: "furniture_only", furniturePath: "bespoke" })).toBe(true);
    expect(boqApplies(palm, { enquiryType: "Full_Fit_Out", furniturePath: null })).toBe(true);
    expect(boqApplies(palm, { enquiryType: "furniture_only", furniturePath: "take_home_now" })).toBe(false);
    expect(boqApplies(palm, { enquiryType: null, furniturePath: null })).toBe(false);
    expect(boqApplies(settings(), { enquiryType: null, furniturePath: null })).toBe(true);
    // Without the job at hand (a file, a command) the list doesn't narrow.
    expect(boqApplies(palm, undefined)).toBe(true);
    expect(effectiveSections(palm, null, { enquiryType: "interior_design", furniturePath: null })).toMatchObject({ boq: false, payments: true });
    expect(effectiveSections(palm, null, { enquiryType: "full_fit_out", furniturePath: null }).boq).toBe(true);
    // The switch itself is off by default and still rules.
    expect(effectiveSections(settings({ boq: false }), null, { enquiryType: "full_fit_out", furniturePath: null }).boq).toBe(false);
    expect(jobCodes([" Full_Fit_Out ", "bespoke", "bespoke", ""], "x")).toEqual(["full_fit_out", "bespoke"]);
    expect(() => jobCodes("full_fit_out", "x")).toThrow(/isn't valid/);
  });

  it("PLM-170: projects the bill of quantities by room at selling rates, with totals, and nothing from the cost side", () => {
    const lines = [
      { id: "l1", roomId: "r1", room: "Kitchen", title: "Cabinets", description: "Oak veneer", quantity: "4.5000", unit: "m", rate: "1200.0000", amount: "5400.0000" },
      { id: "l2", roomId: "r1", room: "Kitchen", title: "Worktop", description: "", quantity: "2.2500", unit: "m²", rate: "800.0000", amount: "1800.0000" },
      { id: "l3", roomId: null, room: null, title: "Lights", description: "", quantity: "1.0000", unit: "nos", rate: "650.0000", amount: "650.0000" },
    ];
    const boq = portalBoq(lines, "AED", "R2");
    expect(boq).toEqual({
      currency: "AED", revision: "R2", total: "7850.00",
      rooms: [
        { id: "r1", name: "Kitchen", total: "7200.00", lines: [
          { id: "l1", title: "Cabinets", description: "Oak veneer", quantity: "4.5", unit: "m", rate: "1200.00", amount: "5400.00" },
          { id: "l2", title: "Worktop", description: "", quantity: "2.25", unit: "m²", rate: "800.00", amount: "1800.00" },
        ] },
        { id: null, name: null, total: "650.00", lines: [{ id: "l3", title: "Lights", description: "", quantity: "1", unit: "nos", rate: "650.00", amount: "650.00" }] },
      ],
    });
    expect(JSON.stringify(boq)).not.toMatch(/cost|margin|package|supplier|unitCost/i);
    expect(portalBoq([], null, null)).toEqual({ currency: null, revision: null, rooms: [], total: "0.00" });
  });

  it("takes a mobile number in international form and never shows an email in full", () => {
    expect(mobileNumber("+1 (202) 555-0123")).toBe("+12025550123");
    expect(() => mobileNumber("0501234567")).toThrow(/country code/);
    expect(maskEmail("maya@example.com")).toBe("m•••@example.com");
  });

  it("stores codes only as an HMAC bound to their challenge", () => {
    const codes = new PortalCodes("s".repeat(40), false);
    expect(codes.next()).toMatch(/^\d{6}$/);
    expect(codes.hash("a", "123456")).not.toBe(codes.hash("b", "123456"));
    expect(new PortalCodes("s".repeat(40), true).next()).toBe("123456");
    expect(codes.requester(undefined)).toBeNull();
  });

  it("projects a quotation field by field: no cost, QS review, manual reasons, catalogue links or who approved it", () => {
    const quote = {
      id: "q", number: 1, kind: "quotation", status: "issued", title: "Kitchen", currency: "USD", validUntil: "2099-01-01", discount: 0, taxRate: 0, terms: "", exclusions: "", total: 100,
      requestIds: [], paymentTerms: [], createdAt: "", approverId: "g1", approvedBy: "QS Person", qsEstimate: { quoteHash: "h", cost: 55, sellingTotal: 100, reviewedAt: "", reviewedById: "u", reviewedBy: "QS" },
      lines: [{ id: "l", room: "Kitchen", title: "Cabinets", specification: "", material: "", finish: "", quantity: 1, unit: "nos", unitCost: 55, rate: 100, manualReason: "no catalogue",
        catalogLinks: [], scopeId: "s1" }],
    } as unknown as Quote;
    const projected = portalQuote(quote, "g1", "approver");
    expect(projected.canDecide).toBe(true);
    expect(portalQuote(quote, "g1", "viewer").canDecide).toBe(false);
    const text = JSON.stringify(projected);
    for (const secret of ["unitCost", "qsEstimate", "approverId", "approvedBy", "QS Person", "manualReason", "catalogLinks", "scopeId", "55"]) expect(text).not.toContain(secret);
  });

  it("shows the team's replies as the team, and never internal comments", () => {
    const request = { id: "r", number: 1, title: "Socket", detail: "One more?", status: "open", owner: "Dana Designer", dueDate: "", resolution: "", createdAt: "",
      comments: [{ id: "c1", author: "Dana Designer", at: "", text: "Yes", visibility: "client" }, { id: "c2", author: "Dana Designer", at: "", text: "Check budget", visibility: "internal" },
        { id: "c3", author: "Maya", at: "", text: "Thanks", visibility: "client" }] } as ChangeRequest;
    const projected = portalRequest(request, { id: "g", caseId: "c", name: "Maya", role: "approver", email: null, confirmed: true, demo: false });
    expect(projected.comments.map((comment) => [comment.text, comment.fromClient])).toEqual([["Yes", false], ["Thanks", true]]);
    expect(JSON.stringify(projected)).not.toMatch(/Dana Designer|Check budget|owner/);
  });

  it("reads a conversation oldest first, and says whether the client's side or the team opened it", () => {
    const grant = { id: "g", caseId: "c", name: "Maya", role: "approver" as const, email: null, confirmed: true, demo: false };
    const request = { id: "r", number: 1, title: "Socket", detail: "One more?", status: "open", owner: "", dueDate: "", resolution: "", createdAt: "2026-10-01T08:00:00.000Z",
      raisedBy: { name: "Maya", client: true },
      comments: [{ id: "late", author: "Dana Designer", at: "2026-10-02T09:00:00.000Z", text: "Done", visibility: "client" },
        { id: "early", author: "Maya", at: "2026-10-01T09:00:00.000Z", text: "Any news?", visibility: "client", fromClient: true },
        { id: "same", author: "Dana Designer", at: "2026-10-02T09:00:00.000Z", text: "Photos next", visibility: "client" }] } as unknown as ChangeRequest;
    const projected = portalRequest(request, grant);
    expect(projected.comments.map((comment) => comment.id)).toEqual(["early", "late", "same"]);
    expect(projected).toMatchObject({ fromClient: true, author: "Maya" });
    expect(projected.comments.map((comment) => comment.author)).toEqual(["Maya", null, null]);
    expect(portalRequest({ ...request, raisedBy: undefined } as ChangeRequest, grant)).toMatchObject({ fromClient: false, author: null });
  });

  it("names the client's team (project manager, designer, sales) by name, work email and drawn avatar only, each role to its first holder", () => {
    const team = portalTeam([
      { role: "manager", membershipId: "m1", name: "Omar Manager", email: "omar@studio.example", avatar: "project_manager-m" },
      { role: "designer", membershipId: "m2", name: "Dana Designer", email: "dana@studio.example", avatar: "../../etc" },
      // The intro meeting's designer loses to the project's own.
      { role: "designer", membershipId: "m3", name: "Intro Designer", email: "intro@studio.example", avatar: null },
      // One person holding two roles is one entry.
      { role: "sales", membershipId: "m1", name: "Omar Manager", email: "omar@studio.example", avatar: "project_manager-m" },
      { role: "site_supervisor" as never, membershipId: "m4", name: "Sid Supervisor", email: "sid@studio.example", avatar: null },
    ]);
    expect(team).toEqual([
      { roles: ["manager", "sales"], name: "Omar Manager", email: "omar@studio.example", avatar: "project_manager-m" },
      { roles: ["designer"], name: "Dana Designer", email: "dana@studio.example", avatar: null },
    ]);
    expect(JSON.stringify(team)).not.toMatch(/membershipId|m1|m2|Intro Designer|Sid Supervisor/);
  });
});
