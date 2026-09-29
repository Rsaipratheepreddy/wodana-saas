import { describe, expect, it } from "vitest";
import { OperatorNotificationsService } from "./operator-notifications.service";

function fakeClient(operators: Array<{ userId: string; role: string }>) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  return {
    calls,
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return sql.includes("FROM platform_administrators") ? { rows: operators, rowCount: operators.length } : { rows: [], rowCount: 0 };
    },
  };
}

describe("operator notifications", () => {
  const service = new OperatorNotificationsService({} as never);
  const event = {
    permission: "sales.read" as const, eventType: "sales_enquiry.received", title: "SE-0001 · Studio Nord", body: "Lena Fischer",
    link: "/internal/sales-enquiries?enquiry=e1", sourceType: "sales_enquiry", sourceId: "e1",
  };

  it("tells only the operators whose role may act on the event", async () => {
    const client = fakeClient([
      { userId: "admin", role: "administrator" },
      { userId: "billing", role: "account_billing_operator" },
      { userId: "domains", role: "domain_operator" },
      { userId: "retired", role: "no_longer_a_role" },
    ]);
    await expect(service.notify(client as never, event)).resolves.toBe(2);
    const insert = client.calls.find((call) => call.sql.includes("INSERT INTO platform_operator_notifications"));
    expect(insert?.values?.[0]).toEqual(["admin", "billing"]);
    expect(insert?.sql).toContain("ON CONFLICT DO NOTHING");
  });

  it("adds nothing when no operator may act", async () => {
    const client = fakeClient([{ userId: "domains", role: "domain_operator" }]);
    await expect(service.notify(client as never, event)).resolves.toBe(0);
    expect(client.calls.some((call) => call.sql.includes("INSERT"))).toBe(false);
  });
});
