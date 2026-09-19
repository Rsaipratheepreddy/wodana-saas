import { describe, expect, it } from "vitest";
import { PROVIDER_ADAPTERS, providerCapabilityView } from "./provider-capabilities";

describe("provider capability registry", () => {
  it("covers every required provider domain without claiming planned adapters are available", () => {
    const codes = new Set(PROVIDER_ADAPTERS.flatMap((adapter) => adapter.capabilities.map((item) => item.code)));
    expect([...codes]).toEqual(expect.arrayContaining([
      "message.send", "lead.ingest", "payment.receipt.read", "accounting.read",
      "signature.send", "calendar.write", "storage.write", "ai.suggest",
    ]));
    expect(PROVIDER_ADAPTERS.filter((adapter) => adapter.implementation === "available").map((adapter) => adapter.id)).toEqual([
      "google_workspace", "quickbooks", "zoho_books", "whatsapp", "wodana_ai",
    ]);
  });

  it("keeps setup, connection, provider operation and delivery verification separate", () => {
    const connections = [{
      id: "connection",
      provider: "whatsapp",
      status: "connected" as const,
      displayName: "Palm WhatsApp",
      updatedAt: "2026-09-18T09:00:00.000Z",
    }];
    const accepted = providerCapabilityView(connections, [{ connectionId: "connection", action: "message.send", occurredAt: "2026-09-18T10:00:00.000Z" }]);
    expect(accepted.find((adapter) => adapter.id === "whatsapp")).toMatchObject({ configurationState: "connected", verificationState: "operation_confirmed" });
    const delivered = providerCapabilityView(connections, [
      { connectionId: "connection", action: "message.send", occurredAt: "2026-09-18T10:00:00.000Z" },
      { connectionId: "connection", action: "provider.webhook_received", occurredAt: "2026-09-18T10:01:00.000Z" },
    ]);
    expect(delivered.find((adapter) => adapter.id === "whatsapp")).toMatchObject({ verificationState: "delivery_verified", verifiedAt: "2026-09-18T10:01:00.000Z" });
    expect(delivered.find((adapter) => adapter.id === "docusign")).toMatchObject({ configurationState: "unavailable", verificationState: "not_tested" });
  });

  it("shows a later provider failure without erasing older success evidence", () => {
    const view = providerCapabilityView([
      { id: "connection", provider: "quickbooks", status: "degraded", displayName: "Books", updatedAt: "2026-09-18T09:00:00.000Z" },
    ], [
      { connectionId: "connection", action: "invoice.create", occurredAt: "2026-09-18T10:00:00.000Z" },
      { connectionId: "connection", action: "integration.provider_read_failed", occurredAt: "2026-09-18T11:00:00.000Z" },
    ]);
    expect(view.find((adapter) => adapter.id === "quickbooks")).toMatchObject({ configurationState: "needs_attention", verificationState: "failed", verifiedAt: "2026-09-18T10:00:00.000Z" });
  });
});
