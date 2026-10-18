import { describe, expect, it, vi } from "vitest";
import { AiCreditsConsoleService } from "./ai-credits-console.service";

function service() {
  const database = { query: vi.fn(), tenantTransaction: vi.fn(), actorTransaction: vi.fn() };
  return { credits: new AiCreditsConsoleService(database as never), database };
}

describe("AI credit commands in Wodana Control", () => {
  it("refuses a top-up without positive credits or a request key, before touching the database", async () => {
    const { credits, database } = service();
    await expect(credits.topUp("tenant_acme", { credits: "0", reference: "INV-1" }, "key-12345678", "op")).rejects.toThrow(/positive number of credits/);
    await expect(credits.topUp("tenant_acme", { credits: "-5", reference: "INV-1" }, "key-12345678", "op")).rejects.toThrow(/positive number/);
    await expect(credits.topUp("tenant_acme", { credits: "1e3", reference: "INV-1" }, "key-12345678", "op")).rejects.toThrow(/up to four decimals/);
    await expect(credits.topUp("tenant_acme", { credits: "500", reference: "INV-1" }, undefined, "op")).rejects.toThrow(/request key/);
    await expect(credits.adjust("tenant_acme", { kind: "adjustment", credits: "0.0000", reference: "Fix" }, "key-12345678", "op")).rejects.toThrow(/non-zero/);
    await expect(credits.adjust("tenant_acme", { kind: "refund", credits: "-3", reference: "Fix" }, "key-12345678", "op")).rejects.toThrow();
    expect(database.query).not.toHaveBeenCalled();
    expect(database.tenantTransaction).not.toHaveBeenCalled();
  });

  it("refuses a rate with a zero margin or a malformed price", async () => {
    const { credits, database } = service();
    const rate = { expectedVersion: 1, listInput: "0.06", listOutput: "0.24", margin: "0", priceConfirmed: true, active: true };
    await expect(credits.setRate("apac.amazon.nova-lite-v1:0", rate, "op")).rejects.toThrow(/more than zero/);
    await expect(credits.setRate("apac.amazon.nova-lite-v1:0", { ...rate, margin: "1.5", listInput: "abc" }, "op")).rejects.toThrow(/positive numbers/);
    expect(database.actorTransaction).not.toHaveBeenCalled();
  });
});
