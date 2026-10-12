import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as shared from "../../../../packages/contracts/src/history";
import { HISTORY_VERBS, describeAction } from "./history-actions";
import { HISTORY_SUBJECTS, fieldChanges, historySubject, redactItem, toHistoryItem, type AuditRow } from "./history-items";
import { HISTORY_RECORD_TYPES } from "./history-records";
import { HISTORY_FILTERS } from "./history.service";

/** Every versioned action code written anywhere in Business Core ("quotation.sent_to_qs.v1"). */
function sourceActions() {
  const found = new Set<string>();
  const walk = (folder: string) => {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) { walk(path); continue; }
      if (!name.endsWith(".ts") || name.endsWith(".spec.ts")) continue;
      for (const match of readFileSync(path, "utf8").matchAll(/["'`]([a-z_]+(?:\.[a-z0-9_]+)+\.v\d+)["'`]/g)) found.add(match[1]);
    }
  };
  walk(join(__dirname, ".."));
  return [...found];
}

/** Actions modules write without a version suffix (module audit helpers), as they appear in the audit trail. */
const UNVERSIONED = [
  "purchase_order.created", "purchase_order.save", "purchase_order.submit", "purchase_order.approve", "purchase_order.send", "purchase_order.confirm", "purchase_order.cancel",
  "purchase_order.close", "goods_receipt.received", "goods_receipt.inspected", "goods_receipt.photo_added", "work_order.planned", "work_order.release", "work_order.start",
  "work_order.report", "work_order.decide_report", "work_order.check", "work_order.approve_drawing", "work_order.dispatch", "work_order.add_material", "work_order.issue_material",
  "project.started", "project.complete_stage", "project.set_member", "project.save_material", "project.send_materials", "project.materials_ready", "project.send_drawings",
  "project.check_drawings", "project.decide_drawings", "project.drawing_uploaded", "project.post_update", "project.hold", "project.completed", "project.assign_lines",
  "site.start_site", "site.save_report", "site.submit", "site.review", "site.return", "site.approve_send", "site.raise_issue", "site.finish_site", "handover.create_pack",
  "handover.issue", "handover.accept", "warranty.decide_claim", "client_portal.quote_decision", "client_portal.design_decision", "client_portal.change_decision",
  "client_portal.handover_decision", "client_portal.materials_decision", "client_portal.comment", "client_portal.board_comment", "client_portal.report_payment",
  "client_portal.request", "client_portal.warranty_claim", "client_invoice.issued", "finance_request.submitted", "finance_request_raised", "petty_cash.save", "petty_cash.submit",
  "petty_cash.approve", "petty_cash.reimburse", "supplier_invoice.entered", "supplier_invoice.submitted", "supplier_payment.recorded", "price_request.created",
  "work.create", "work.update", "commercial.issue.v1", "commercial.verify_payment.v1", "commercial.approve.v1", "commercial.submit_owner_review.v1",
  "commercial.decide_owner_review.v1", "commercial.execute_agreement.v1", "commercial.release.v1", "commercial.return.v1", "commercial.payment.v1",
  // The order, work order and finance request logs the history reads alongside the audit trail.
  ...["accepted", "alternate_accepted", "alternate_offered", "alternate_rejected", "approved", "cancelled", "changing", "chased", "closed", "confirmed", "continued_on_hold",
    "created", "email_not_sent", "emailed", "funds_asked", "funds_override", "hold_override", "inspected", "line_cancelled", "over_funds", "receipt_reversed", "received",
    "return_cancelled", "return_emailed", "return_raised", "return_sent", "returned", "sent", "shipment_added", "shipment_updated", "submitted", "under_threshold"].map((kind) => `purchase_order.${kind}`),
  ...["planned", "approve_drawing", "start", "release", "report", "check", "decide_report", "dispatch", "add_material", "issue_material"].map((kind) => `work_order.${kind}`),
  ...["submitted", "approval", "file", "needs_info", "rejected"].map((kind) => `finance_request.${kind}`),
];

describe("history: every action reads as a sentence", () => {
  it("gives every action written in Business Core a verb of its own (not the fallback)", () => {
    const actions = [...sourceActions(), ...UNVERSIONED];
    expect(actions.length).toBeGreaterThan(300);
    const fallback = actions.filter((action) => !describeAction(action).known);
    expect(fallback).toEqual([]);
    for (const action of actions) expect(HISTORY_VERBS).toContain(describeAction(action).verb);
  });

  it("reads the actions people look for the way they say them", () => {
    const verb = (action: string) => describeAction(action).verb;
    expect(verb("commercial.issue.v1")).toBe("sent");
    expect(verb("commercial.verify_payment.v1")).toBe("verified");
    expect(verb("purchase_order.approve")).toBe("approved");
    expect(verb("quotation.sent_to_qs.v1")).toBe("sent_for_review");
    expect(verb("site.raise_issue")).toBe("raised");
    expect(verb("site.return")).toBe("returned");
    expect(verb("crm.opportunity.stage_changed.v1")).toBe("advanced");
    expect(verb("crm.opportunity.won.v1")).toBe("won");
    expect(verb("change_request.signature_requested.v1")).toBe("requested_signature");
    expect(describeAction("client_portal.board_comment").category).toBe("message");
    expect(describeAction("approvals.requested.v1").category).toBe("approval");
    expect(describeAction("purchase_order.created").category).toBe("change");
  });

  it("degrades an unknown action to an update instead of showing its code", () => {
    expect(describeAction("zz.something_new_entirely.v7")).toEqual({ verb: "updated", category: "change", known: false });
    expect(describeAction("")).toEqual({ verb: "updated", category: "change", known: false });
  });
});

describe("history: items", () => {
  const row = (over: Partial<AuditRow>): AuditRow => ({
    id: "11111111-1111-4111-8111-111111111111", action: "purchase_order.approve", entityType: "purchase_order", entityId: "22222222-2222-4222-8222-222222222222",
    source: "user", occurredAt: "2026-10-12T09:00:00.000Z", before: null, after: null, actorId: "33333333-3333-4333-8333-333333333333", actorName: "Paula Purchasing",
    actorRoles: ["procurement"], actorPreset: null, ...over,
  });
  const facts = { reference: "PO-2026-00011", title: null, caseId: null, projectId: null };

  it("names who did what to which record, with its number", () => {
    const item = toHistoryItem(row({}), "purchase_order", "22222222-2222-4222-8222-222222222222", facts, ["purchase_order"]);
    expect(item).toMatchObject({ verb: "approved", category: "approval", subject: "purchase_order", reference: "PO-2026-00011", actor: { name: "Paula Purchasing", kind: "person", roles: ["procurement"] } });
  });

  it("reads amounts, notes and the client as the actor", () => {
    const item = toHistoryItem(row({ action: "commercial.verify_payment.v1", entityType: "commercial_case", entityId: "44444444-4444-4444-8444-444444444444", after: { amount: "15000", currency: "AED", note: "Bank transfer" } }),
      "quotation", "44444444-4444-4444-8444-444444444444", facts, []);
    expect(item).toMatchObject({ verb: "verified", subject: "payment", amount: { value: "15000", currency: "AED" }, note: "Bank transfer" });
    const client = toHistoryItem(row({ action: "client_portal.quote_decision", source: "client_portal", actorId: null, actorName: null, entityType: "pre_project_case", after: { decision: "accept", by: "Aisha Rahman" } }),
      "quotation", "44444444-4444-4444-8444-444444444444", facts, []);
    expect(client.actor).toMatchObject({ kind: "client", name: "Aisha Rahman" });
    expect(client.verb).toBe("approved");
  });

  it("shows field changes before → after, without ids, versions or timestamps", () => {
    expect(fieldChanges({ status: "open", probability: "35.00", version: 3, stage_id: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2", updated_at: "x", title: "Villa" },
      { status: "won", probability: "100.00", version: 4, stage_id: "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2", updated_at: "y", title: "Villa" }))
      .toEqual([{ field: "status", before: "open", after: "won" }, { field: "probability", before: "35.00", after: "100.00" }]);
    expect(fieldChanges(null, { status: "won" })).toEqual([]);
    expect(fieldChanges({ owner: "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3" }, { owner: "d3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3" })).toEqual([]);
  });

  it("links related records it can name and never the record itself", () => {
    const projectId = "55555555-5555-4555-8555-555555555555", reportId = "66666666-6666-4666-8666-666666666666";
    const item = toHistoryItem(row({ action: "site.approve_send", entityType: "project", entityId: projectId, after: { reportId, projectId } }), "project", projectId, { ...facts, projectId }, ["project"]);
    expect(item.subject).toBe("site_report");
    expect(item.links).toEqual([{ type: "site_report", id: reportId, projectId }]);
    const own = toHistoryItem(row({ action: "site.approve_send", entityType: "project", entityId: projectId, after: { reportId, projectId } }), "site_report", reportId, { ...facts, projectId }, ["site_report"]);
    expect(own.links).toEqual([{ type: "project", id: projectId }]);
  });

  it("never shows costs, and values and internal notes only to those who may see them", () => {
    const base = toHistoryItem(row({ action: "crm.opportunity.updated.v1", entityType: "crm_lead", after: { amount: "90000", currency_code: "AED", note: "Budget is tight" },
      before: { amount: "80000", margin: "30", internalNotes: "x" } }), "lead", "22222222-2222-4222-8222-222222222222", facts, ["crm_lead"]);
    const withAll = { ...base, changes: [{ field: "amount", before: "80000", after: "90000" }, { field: "margin", before: "30", after: "35" }, { field: "internalNotes", before: "a", after: "b" }, { field: "status", before: "new", after: "open" }] };
    expect(redactItem(withAll, { values: true, notes: true }).changes.map((change) => change.field)).toEqual(["amount", "internalNotes", "status"]);
    const hidden = redactItem(withAll, { values: false, notes: false });
    expect(hidden.changes.map((change) => change.field)).toEqual(["status"]);
    expect(hidden.amount).toBeNull();
    expect(hidden.note).toBeNull();
  });

  it("knows the subject of every kind of event", () => {
    expect(historySubject("approval_request", "approvals.requested.v1", { kind: "quote_qs" })).toBe("quotation");
    expect(historySubject("project", "handover.issue", {})).toBe("handover_pack");
    expect(historySubject("pre_project_case", "change_request.signed.v1", {})).toBe("change_request");
    expect(historySubject("commercial_case", "commercial.submit_owner_review.v1", {})).toBe("deal_file");
    expect(historySubject("work_item", "work.create", {}, "snag")).toBe("snag");
    expect(historySubject("something_else", "x.y", {})).toBe("record");
  });
});

describe("history: the shared contract", () => {
  it("matches packages/contracts/src/history.ts", () => {
    expect([...HISTORY_VERBS]).toEqual([...shared.HISTORY_VERBS]);
    expect([...HISTORY_SUBJECTS]).toEqual([...shared.HISTORY_SUBJECTS]);
    expect([...HISTORY_RECORD_TYPES]).toEqual([...shared.HISTORY_RECORD_TYPES]);
    expect([...HISTORY_FILTERS]).toEqual([...shared.HISTORY_FILTERS]);
  });
});
