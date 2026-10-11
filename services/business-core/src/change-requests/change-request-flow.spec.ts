import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { changeReminderRound } from "./change-request-reminders";
import { allowedActions, cleanProjectDraft, cleanScopeLine, nextStep, replacementId, signedAmount, variationOps, variationPaymentTerms, type ChangeRights } from "./change-request-flow";
import { ChangeRuleError, nextStatus } from "./change-request.domain";

const room = randomUUID(), item = randomUUID(), boq = randomUUID();
const line = (overrides: Record<string, unknown> = {}) => ({ id: randomUUID(), source: "custom", title: "Extra shelf", quantity: "2", unit: "nos", ...overrides });

describe("a project change's raised lines (§6.20)", () => {
  it("takes new work, a catalogue item, or a live-scope line removed, replaced or moved", () => {
    expect(cleanScopeLine(line({ unitPrice: "450.5", roomId: room }), 0)).toMatchObject({ source: "custom", action: "add", quantity: "2", unitPrice: "450.50", roomId: room });
    expect(cleanScopeLine(line({ source: "catalog", catalogItemId: item, unitPrice: "1" }), 0)).toMatchObject({ action: "add", catalogItemId: item, unitPrice: null });
    expect(cleanScopeLine(line({ source: "boq_line", action: "omit", boqLineId: boq, quantity: "1.25" }), 0)).toMatchObject({ action: "omit", boqLineId: boq, quantity: "1.25" });
    expect(cleanScopeLine(line({ source: "boq_line", action: "move", boqLineId: boq, roomId: room, quantity: undefined }), 0)).toMatchObject({ action: "move", quantity: null, roomId: room });
  });

  it("refuses lines that don't say what they change", () => {
    expect(() => cleanScopeLine(line({ source: "ledger" }), 0)).toThrow(ChangeRuleError);
    expect(() => cleanScopeLine(line({ quantity: "0" }), 1)).toThrow(/Line 2: quantity must be above zero/);
    expect(() => cleanScopeLine(line({ quantity: "" }), 0)).toThrow(/enter the quantity/);
    expect(() => cleanScopeLine(line({ source: "catalog" }), 0)).toThrow(/catalogue item/);
    expect(() => cleanScopeLine(line({ source: "boq_line", action: "add", boqLineId: boq }), 0)).toThrow(/remove, replace or move/);
    expect(() => cleanScopeLine(line({ source: "boq_line", action: "move", boqLineId: boq }), 0)).toThrow(/room it moves to/);
    expect(() => cleanScopeLine(line({ unitPrice: "1.234" }), 0)).toThrow(/two decimals/);
    expect(() => cleanProjectDraft({ title: " ", lines: [] })).toThrow(/Name the change/);
    const scope = line({ source: "boq_line", action: "omit", boqLineId: boq, quantity: "1" });
    expect(() => cleanProjectDraft({ title: "x", lines: [scope, { ...scope, id: randomUUID() }] })).toThrow(/once per change/);
    expect(cleanProjectDraft({ title: "x", reason: "nope" }).reason).toBe("client_request");
  });

  it("puts them on the variation as the builder's commands, each keeping its id (a replacement's new line derived, so pricing twice adds it once)", () => {
    const lines = cleanProjectDraft({ title: "x", lines: [
      line({ id: "11111111-1111-4111-8111-111111111111", unitPrice: "450.50", roomId: room }),
      line({ id: "22222222-2222-4222-8222-222222222222", source: "catalog", catalogItemId: item }),
      line({ id: "33333333-3333-4333-8333-333333333333", source: "boq_line", action: "replace", boqLineId: boq, quantity: "1" }),
      line({ id: "44444444-4444-4444-8444-444444444444", source: "boq_line", action: "move", boqLineId: randomUUID(), roomId: room, quantity: undefined }),
    ] }).lines;
    const ops = variationOps(lines);
    expect(ops.map((op) => op.op)).toEqual(["upsert", "catalog", "change", "change"]);
    expect(ops[0]).toMatchObject({ line: { rate: "450.50", areaId: room } });
    expect(ops[2]).toMatchObject({ change: "replace", replacementId: replacementId("33333333-3333-4333-8333-333333333333") });
    expect(replacementId("33333333-3333-4333-8333-333333333333")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(replacementId("33333333-3333-4333-8333-333333333333")).not.toBe("33333333-3333-4333-8333-333333333333");
  });
});

describe("how a variation is paid (the firm's rule)", () => {
  it("is all before the work, or with the next milestone; a credit has no payment terms", () => {
    expect(variationPaymentTerms("before_work", "5251.05", null)).toEqual([expect.objectContaining({ percent: 100, requiredForRelease: true })]);
    expect(variationPaymentTerms("next_milestone", "10", { title: "Before installation" })).toEqual([expect.objectContaining({ title: "With Before installation", requiredForRelease: false })]);
    // No milestone left to go with: before the work.
    expect(variationPaymentTerms("next_milestone", "10", null)[0].requiredForRelease).toBe(true);
    expect(variationPaymentTerms("before_work", "-800", null)).toEqual([]);
    expect(variationPaymentTerms("before_work", "0", null)).toEqual([]);
    expect([signedAmount("5251.05"), signedAmount("-800"), signedAmount("0")]).toEqual(["+5251.05", "-800.00", "0.00"]);
  });
});

describe("a project change's steps, and who takes them", () => {
  it("moves draft → pricing → approval → to send → client → approved → applied; returned goes back to pricing", () => {
    expect(nextStatus("draft", "price", "project")).toBe("pricing");
    expect(nextStatus("pricing", "edit", "project")).toBe("pricing");
    expect(nextStatus("pricing", "submit", "project")).toBe("pending_approval");
    expect(nextStatus("pending_approval", "returned", "project")).toBe("pricing");
    expect(nextStatus("pending_approval", "internal_approved", "project")).toBe("to_send");
    expect(nextStatus("to_send", "send", "project")).toBe("with_client");
    expect(nextStatus("with_client", "client_approved", "project")).toBe("approved");
    expect(nextStatus("approved", "apply", "project")).toBe("applied");
    expect(() => nextStatus("applied", "apply", "project")).toThrow(/already approved and applied/);
    expect(() => nextStatus("draft", "submit", "project")).toThrow(/still being assessed/);
    expect(() => nextStatus("declined", "withdraw", "project")).toThrow(/declined/);
    // A planning record's change keeps its own steps (no pricing, sent straight to the client).
    expect(nextStatus("pending_approval", "internal_approved")).toBe("with_client");
    expect(() => nextStatus("draft", "price")).toThrow(ChangeRuleError);
  });

  const rights = (overrides: Partial<ChangeRights> = {}): ChangeRights => ({ view: true, commercial: false, manager: false, raiser: false, approver: false, ...overrides });
  it("gives each person their next step: the raiser edits, Sales prices, the QS first where the rules say, the approver approves, the project manager applies", () => {
    const at = (status: string, qs = "not_needed") => ({ status: status as never, hasQuote: status !== "draft", qs: qs as never });
    expect(allowedActions(at("draft"), rights({ raiser: true }))).toEqual(["edit", "upload", "withdraw"]);
    expect(nextStep(allowedActions(at("draft"), rights({ raiser: true })))).toBeNull();
    expect(nextStep(allowedActions(at("draft"), rights({ commercial: true })))).toBe("price");
    expect(nextStep(allowedActions(at("pricing", "needed"), rights({ commercial: true })))).toBe("send_to_qs");
    expect(nextStep(allowedActions(at("pricing", "with_qs"), rights({ commercial: true })))).toBeNull();
    expect(nextStep(allowedActions(at("pricing", "confirmed"), rights({ manager: true })))).toBe("submit");
    expect(nextStep(allowedActions(at("pending_approval"), rights({ approver: true })))).toBe("approve");
    expect(nextStep(allowedActions(at("pending_approval"), rights({ commercial: true })))).toBeNull();
    expect(nextStep(allowedActions(at("to_send"), rights({ manager: true })))).toBe("send");
    expect(allowedActions(at("with_client"), rights({ manager: true }))).toEqual(["send_link", "withdraw"]);
    expect(nextStep(allowedActions(at("approved"), rights({ manager: true })))).toBe("apply");
    expect(nextStep(allowedActions(at("approved"), rights({ commercial: true })))).toBeNull();
    expect(allowedActions(at("applied"), rights({ manager: true, commercial: true }))).toEqual([]);
    expect(allowedActions(at("draft"), rights({ view: false, commercial: true }))).toEqual([]);
  });

  it("reminds on the firm's days, the latest round once", () => {
    expect([changeReminderRound(2, [3, 7]), changeReminderRound(3, [3, 7]), changeReminderRound(9, [7, 3, 3]), changeReminderRound(9, [])]).toEqual([0, 1, 2, 0]);
  });
});
