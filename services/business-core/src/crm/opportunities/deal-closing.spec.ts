import { describe, expect, it } from "vitest";
import { closingState, type ClosingFacts } from "./deal-closing";

const none: ClosingFacts = { collectedAt: null, deliveredAt: null, installedAt: null, workOrders: { total: 0, open: 0, lastReadyAt: null }, designApprovedAt: null, handoverAcceptedAt: null };

describe("PLM-102 Deal Closed is computed from records", () => {
  it("closes furniture deals on collection or delivery, per path", () => {
    expect(closingState("collected", none).closed).toBe(false);
    expect(closingState("collected", { ...none, collectedAt: "2026-10-06T10:00:00.000Z" })).toMatchObject({ closed: true, closedAt: "2026-10-06T10:00:00.000Z" });
    expect(closingState("delivered", { ...none, collectedAt: "2026-10-06T10:00:00.000Z" }).closed).toBe(false);
    expect(closingState("collected_or_delivered", { ...none, deliveredAt: "2026-10-07T10:00:00.000Z" })).toMatchObject({ closed: true, checks: [{ key: "collected_or_delivered", done: true }] });
  });

  it("closes a design deal at design handover and a fit-out at the accepted completion and handover", () => {
    expect(closingState("design_handover", { ...none, designApprovedAt: "2026-10-08T00:00:00.000Z" }).closed).toBe(true);
    expect(closingState("completion_handover", none).closed).toBe(false);
    expect(closingState("completion_handover", { ...none, handoverAcceptedAt: "2026-12-01T00:00:00.000Z" }).closed).toBe(true);
  });

  it("closes ID & Furniture once everything is produced and delivered or installed; the signed handover too when there was site work (guide J)", () => {
    const delivered = { ...none, deliveredAt: "2026-11-01T00:00:00.000Z" };
    expect(closingState("all_produced_delivered_installed", { ...delivered, workOrders: { total: 3, open: 1, lastReadyAt: "2026-10-30T00:00:00.000Z" } }).closed).toBe(false);
    const done = closingState("all_produced_delivered_installed", { ...delivered, workOrders: { total: 3, open: 0, lastReadyAt: "2026-10-30T00:00:00.000Z" } });
    expect(done).toMatchObject({ closed: true, closedAt: "2026-11-01T00:00:00.000Z" });
    expect(done.checks.map((check) => check.key)).toEqual(["produced", "delivered"]);
    // Installed on site: the handover form is signed before it closes.
    const site = { ...delivered, installedAt: "2026-10-31T00:00:00.000Z", siteWork: true, workOrders: { total: 3, open: 0, lastReadyAt: "2026-10-30T00:00:00.000Z" } };
    expect(closingState("all_produced_delivered_installed", site)).toMatchObject({ closed: false });
    expect(closingState("all_produced_delivered_installed", { ...site, handoverAcceptedAt: "2026-11-03T00:00:00.000Z" })).toMatchObject({ closed: true, closedAt: "2026-11-03T00:00:00.000Z" });
  });

  it("is never closed without a closing event", () => {
    expect(closingState(null, { ...none, deliveredAt: "2026-11-01T00:00:00.000Z" })).toMatchObject({ event: null, closed: false, checks: [] });
  });
});
