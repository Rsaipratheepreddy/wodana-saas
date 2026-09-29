import { describe, expect, it, vi } from "vitest";

const tellClients = vi.fn();
vi.mock("../client-portal/portal-notices", () => ({ tellClients: (...args: unknown[]) => tellClients(...args) }));

import { QuoteShareService, shareMessage, whatsappNumber } from "./quote-share.service";

const access = (client: unknown, can = true) => ({
  withPermission: vi.fn(async (_actor: unknown, _workspace: string, _permission: string, work: (db: unknown, user: { userId: string }) => unknown) => work(client, { userId: "u1" })),
  hasPermission: vi.fn(async () => can),
});

describe("sharing a sent quote (Q-9)", () => {
  it("keeps only numbers WhatsApp can dial", () => {
    expect(whatsappNumber("+1 (555) 123-4567")).toBe("15551234567");
    expect(whatsappNumber("123")).toBeNull();
  });

  it("writes the message with the link and the validity", () => {
    expect(shareMessage({ firstName: "Aisha", company: "Studio", title: "Kitchen (Q-2)", url: "https://x.test/p", validUntil: "15 October 2026" }))
      .toBe("Hello Aisha, Studio has sent you Kitchen (Q-2). It is valid until 15 October 2026. Open it here to review and decide: https://x.test/p");
  });

  it("sends the notice again once an hour at most, audited", async () => {
    tellClients.mockResolvedValue({ queued: 1, reason: null, channel: "email", names: ["Aisha"] });
    const queries: string[] = [];
    const client = { query: vi.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes("FROM commercial_quotes")) return { rows: [{ id: "q1", number: 2, title: "Kitchen", status: "issued", hash: "h", validUntil: "2026-10-15", clientName: "Aisha" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }) };
    const service = new QuoteShareService(access(client) as never, { get: () => undefined } as never);
    await expect(service.resend({} as never, "w", "c", "q1")).resolves.toEqual({ channel: "email", emailed: ["Aisha"], reason: null });
    expect(tellClients.mock.calls[0][1]).toMatchObject({ event: "quote_issued", recordId: expect.stringMatching(/^q1:h:resent:\d{4}-\d{2}-\d{2}T\d{2}$/) });
    expect(queries.some((sql) => sql.includes("INSERT INTO audit_events"))).toBe(true);
  });

  it("refuses a quote that isn't waiting for the client", async () => {
    const client = { query: vi.fn(async () => ({ rows: [{ id: "q1", number: 2, title: "Kitchen", status: "accepted", hash: "h", validUntil: null, clientName: null }], rowCount: 1 })) };
    const service = new QuoteShareService(access(client) as never, { get: () => undefined } as never);
    await expect(service.share({} as never, "w", "c", "q1")).rejects.toThrow(/waiting for the client/);
  });
});
