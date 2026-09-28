import { describe, expect, it, vi } from "vitest";
import { AiCreditRefusal, chargeUsage, checkCredits, creditLimits } from "./ai-credits";
import {
  compareCredits, creditNoticeFor, creditsPerMillion, fromUnits, isCreditAmount, lowBalanceThreshold, normalizeCredits, toUnits, usageCredits, wholeCredits,
} from "./ai-credits.domain";

describe("credit arithmetic (no floats)", () => {
  it("reads and writes numeric(14,4) strings exactly", () => {
    expect(toUnits("12.3456")).toBe(123456n);
    expect(toUnits("-0.5")).toBe(-5000n);
    expect(fromUnits(-5000n)).toBe("-0.5000");
    expect(fromUnits(0n)).toBe("0.0000");
    expect(normalizeCredits("0.00005")).toBe("0.0001");
    expect(normalizeCredits("1000")).toBe("1000.0000");
    expect(compareCredits("0.1", "0.1000")).toBe(0);
    expect(isCreditAmount("1000.25")).toBe(true);
    expect(isCreditAmount("1e3")).toBe(false);
    expect(isCreditAmount("0.12345")).toBe(false);
  });

  it("turns list prices and the margin into credits per million tokens (1 credit = US$0.001)", () => {
    expect(creditsPerMillion("0.06", "1.5")).toBe("90.0000");
    expect(creditsPerMillion("0.24", "1.5")).toBe("360.0000");
    expect(creditsPerMillion("0.035", "1.5")).toBe("52.5000");
    expect(creditsPerMillion("9", "1")).toBe("9000.0000");
  });

  it("prices a Woddy reply on Nova Lite: 2,000 in and 300 out", () => {
    // (2,000 × 90 + 300 × 360) / 1,000,000 = 0.288 credits = US$0.000288 billed (US$0.000192 at list price).
    expect(usageCredits({ input_tokens: 2000, output_tokens: 300 }, { inputPerMillion: "90", outputPerMillion: "360" })).toBe("0.2880");
    expect(usageCredits({ input_tokens: 1, output_tokens: 0 }, { inputPerMillion: "90", outputPerMillion: "360" })).toBe("0.0001");
    expect(usageCredits({ input_tokens: 0, output_tokens: 0 }, { inputPerMillion: "90", outputPerMillion: "360" })).toBe("0.0000");
    expect(usageCredits({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, { inputPerMillion: "2250", outputPerMillion: "13500" })).toBe("15750.0000");
  });

  it("draws the low-balance line at the workspace's own number or 20% of the last topped-up balance", () => {
    expect(lowBalanceThreshold({ lowBalanceThreshold: null, lastTopUpBalance: "1000.0000" })).toBe("200.0000");
    expect(lowBalanceThreshold({ lowBalanceThreshold: "50", lastTopUpBalance: "1000" })).toBe("50.0000");
    expect(lowBalanceThreshold({ lowBalanceThreshold: null, lastTopUpBalance: null })).toBe("0.0000");
  });

  it("tells owners once per crossing, and a top-up re-arms both notices", () => {
    const none = { lowNotified: false, exhaustedNotified: false };
    expect(creditNoticeFor("500", "200", none)).toEqual({ notice: null, ...none });
    const low = creditNoticeFor("199.9", "200", none);
    expect(low).toEqual({ notice: "low", lowNotified: true, exhaustedNotified: false });
    expect(creditNoticeFor("150", "200", low).notice).toBeNull();
    const out = creditNoticeFor("-0.2", "200", low);
    expect(out).toEqual({ notice: "exhausted", lowNotified: true, exhaustedNotified: true });
    expect(creditNoticeFor("-0.4", "200", out).notice).toBeNull();
    // Straight from above the line to nothing: one notice, the exhausted one.
    expect(creditNoticeFor("0", "200", none)).toEqual({ notice: "exhausted", lowNotified: true, exhaustedNotified: true });
    expect(creditNoticeFor("5000", "1000", out)).toEqual({ notice: null, lowNotified: false, exhaustedNotified: false });
    expect(wholeCredits("182.9999")).toBe("182");
    expect(wholeCredits("-0.2")).toBe("-1");
  });

  it("reads the platform settings, falling back to safe defaults", () => {
    expect(creditLimits({})).toEqual({ welcome: "1000.0000", workspaceDaily: "1000.0000", platformDaily: "5000.0000" });
    expect(creditLimits({ AI_WELCOME_CREDITS: "250", AI_WORKSPACE_DAILY_CREDIT_LIMIT: "-5", AI_PLATFORM_DAILY_CREDIT_LIMIT: "lots" }))
      .toEqual({ welcome: "250.0000", workspaceDaily: "1000.0000", platformDaily: "5000.0000" });
  });
});

/** A scripted client: each query is answered by the first rule whose pattern matches. */
function fakeDb(rules: Array<[RegExp, (values: unknown[]) => { rows: unknown[]; rowCount?: number }]>) {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const db = { query: vi.fn(async (sql: string, values: unknown[] = []) => {
    queries.push({ sql, values });
    const rule = rules.find(([pattern]) => pattern.test(sql));
    const result = rule ? rule[1](values) : { rows: [] };
    return { rowCount: result.rows.length, ...result };
  }) };
  return { db: db as never, queries };
}
const account = (balance: string, extra: Record<string, unknown> = {}) => ({ balance, lowBalanceThreshold: null, lastTopUpCredits: "1000.0000",
  lastTopUpBalance: "1000.0000", lastTopUpAt: new Date(), lowNotifiedAt: null, exhaustedNotifiedAt: null, version: 3, ...extra });
const limits = { welcome: "1000.0000", workspaceDaily: "1000.0000", platformDaily: "5000.0000" };

describe("the refusal before a call", () => {
  it("creates the account with the welcome grant on first use and lets the call through", async () => {
    const { db, queries } = fakeDb([
      [/INSERT INTO ai_credit_accounts/, () => ({ rows: [{ balance: "1000.0000" }] })],
      [/FROM ai_credit_accounts WHERE workspace_id = \$1 FOR UPDATE/, () => ({ rows: [account("1000.0000")] })],
      [/AS reached FROM ai_credit_ledger/, () => ({ rows: [{ reached: false }] })],
      [/ai_platform_usage_today/, () => ({ rows: [{ used: "12.0000", reached: false }] })],
    ]);
    await expect(checkCredits(db, "w", limits)).resolves.toBeNull();
    const grant = queries.find((query) => query.sql.includes("'grant'"));
    expect(grant?.values).toEqual(["w", "1000.0000"]);
  });

  it("refuses at zero or below, and when today's workspace or platform cap is reached", async () => {
    const base = (balance: string, workspace: boolean, platform: boolean) => fakeDb([
      [/FROM ai_credit_accounts WHERE workspace_id = \$1 FOR UPDATE/, () => ({ rows: [account(balance, { exhaustedNotifiedAt: new Date() })] })],
      [/AS reached FROM ai_credit_ledger/, () => ({ rows: [{ reached: workspace }] })],
      [/ai_platform_usage_today/, () => ({ rows: [{ used: "5000.0000", reached: platform }] })],
    ]).db;
    await expect(checkCredits(base("0.0000", false, false), "w", limits)).resolves.toBe("exhausted");
    await expect(checkCredits(base("-0.2000", false, false), "w", limits)).resolves.toBe("exhausted");
    await expect(checkCredits(base("10.0000", true, false), "w", limits)).resolves.toBe("workspace_daily");
    await expect(checkCredits(base("10.0000", false, true), "w", limits)).resolves.toBe("platform_daily");
    expect(new AiCreditRefusal("exhausted").getStatus()).toBe(402);
  });
});

describe("metering a call", () => {
  it("debits tokens × the model's rate with the call's key and records the balance after", async () => {
    const { db, queries } = fakeDb([
      [/FROM ai_model_rates/, () => ({ rows: [{ model: "apac.amazon.nova-lite-v1:0", inputPerMillion: "90.0000", outputPerMillion: "360.0000", exact: true }] })],
      [/FROM ai_credit_accounts WHERE workspace_id = \$1 FOR UPDATE/, () => ({ rows: [account("500.0000")] })],
      [/UPDATE ai_credit_accounts SET balance/, (values) => ({ rows: [account(normalizeCredits(fromUnits(toUnits("500") + toUnits(String(values[1])))))] })],
      [/INSERT INTO ai_credit_ledger AS entry/, (values) => ({ rows: [{ id: "e1", entryType: values[1], credits: values[2], balanceAfter: values[3] }] })],
    ]);
    await chargeUsage(db, { workspaceId: "w", callId: "call-1", model: "apac.amazon.nova-lite-v1:0", feature: "crm.chat", usage: { input_tokens: 2000, output_tokens: 300 }, userId: "u1" });
    const insert = queries.find((query) => query.sql.includes("INSERT INTO ai_credit_ledger AS entry"))!;
    expect(insert.values.slice(0, 8)).toEqual(["w", "usage", "-0.2880", "499.7120", "apac.amazon.nova-lite-v1:0", "crm.chat", 2000, 300]);
    expect(insert.values[10]).toBe("usage:call-1");
    // Nothing crossed: no notice.
    expect(queries.some((query) => query.sql.includes("INSERT INTO notifications"))).toBe(false);
  });

  it("charges a model without a rate at the most expensive active rate", async () => {
    const { db, queries } = fakeDb([
      [/FROM ai_model_rates/, () => ({ rows: [{ model: "gemini-3.5-flash", inputPerMillion: "2250.0000", outputPerMillion: "13500.0000", exact: false }] })],
      [/FROM ai_credit_accounts WHERE workspace_id = \$1 FOR UPDATE/, () => ({ rows: [account("500.0000")] })],
      [/UPDATE ai_credit_accounts SET balance/, () => ({ rows: [account("499.0000")] })],
      [/INSERT INTO ai_credit_ledger AS entry/, (values) => ({ rows: [{ id: "e1", credits: values[2], balanceAfter: values[3] }] })],
    ]);
    await chargeUsage(db, { workspaceId: "w", callId: "c", model: "new-model", feature: "crm.chat", usage: { input_tokens: 100, output_tokens: 10 }, userId: "u1" });
    expect(queries.find((query) => query.sql.includes("INSERT INTO ai_credit_ledger AS entry"))!.values[2]).toBe("-0.3600");
  });

  it("tells owners and administrators in the app and by email when the balance crosses the low line", async () => {
    const { db, queries } = fakeDb([
      [/FROM ai_model_rates/, () => ({ rows: [{ model: "m", inputPerMillion: "90.0000", outputPerMillion: "360.0000", exact: true }] })],
      [/FROM ai_credit_accounts WHERE workspace_id = \$1 FOR UPDATE/, () => ({ rows: [account("200.1000")] })],
      [/UPDATE ai_credit_accounts SET balance/, () => ({ rows: [account("199.8120")] })],
      [/INSERT INTO ai_credit_ledger AS entry/, () => ({ rows: [{ id: "entry-1" }] })],
      [/role.code IN \('owner', 'administrator'\)/, () => ({ rows: [{ userId: "owner-1" }] })],
      [/FROM notification_templates/, () => ({ rows: [{ id: "t", subject: "AI credits are running low", body: "{{balance}} credits left. Contact support to top up." }] })],
      [/INSERT INTO notifications/, () => ({ rows: [{ id: "n", correlationId: "c" }], rowCount: 1 })],
    ]);
    await chargeUsage(db, { workspaceId: "w", callId: "c", model: "m", feature: "crm.chat", usage: { input_tokens: 2000, output_tokens: 300 }, userId: "u1" });
    const notices = queries.filter((query) => query.sql.includes("INSERT INTO notifications"));
    expect(notices.map((query) => query.sql.includes("'in_app'") ? "in_app" : "email")).toEqual(["in_app", "email"]);
    expect(notices[0].values).toEqual(expect.arrayContaining(["owner-1", "ai.credits_low", "199 credits left. Contact support to top up.", "/workspace/settings/ai-credits", "ai.credits_low:entry-1:owner-1"]));
    const flags = queries.find((query) => query.sql.includes("SET low_balance_notified_at"))!;
    expect(flags.values).toEqual(["w", true, false]);
  });
});
