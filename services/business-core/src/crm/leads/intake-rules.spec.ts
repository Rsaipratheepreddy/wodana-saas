import { describe, expect, it, vi } from "vitest";
import { assertCustomerType, assertSourceAllowed, resolveReferral } from "./intake-rules";

const client = (answers: Record<string, unknown[]>) => ({ query: vi.fn(async (sql: string) => {
  const key = Object.keys(answers).find((part) => sql.includes(part));
  return { rowCount: key ? answers[key].length : 0, rows: key ? answers[key] : [] };
}) }) as never;

describe("sales intake rules", () => {
  it("shapes the referrer by channel", async () => {
    expect(await resolveReferral(client({}), "w", "company", "call", undefined)).toBeNull();
    await expect(resolveReferral(client({}), "w", "referral", "external", {})).rejects.toThrow(/name of the person/);
    await expect(resolveReferral(client({}), "w", "referral", "internal", { membershipId: "m1" })).rejects.toThrow(/active team member/);
    expect(await resolveReferral(client({ "FROM workspace_memberships": [{}] }), "w", "referral", "internal", { membershipId: "m1" })).toMatchObject({ kind: "internal", membershipId: "m1" });
    await expect(resolveReferral(client({}), "w", "referral", "partner", { option: "odg" })).rejects.toThrow(/partner list/);
    expect(await resolveReferral(client({ "FROM crm_taxonomy_options": [{}] }), "w", "referral", "broker", { option: "acme" })).toMatchObject({ kind: "broker", option: "acme" });
  });
  it("limits a source to its roles", async () => {
    await expect(assertSourceAllowed(client({ "allowed_role_codes": [{ roles: ["SALES"], label: "Self Generated" }] }), "w", "u", "self_generated")).rejects.toThrow(/Only some roles can create Self Generated/);
    await expect(assertSourceAllowed(client({ "allowed_role_codes": [{ roles: ["SALES"], label: "Self Generated" }], "effective_member_roles": [{}] }), "w", "u", "self_generated")).resolves.toBeUndefined();
    await expect(assertSourceAllowed(client({ "allowed_role_codes": [{ roles: null, label: "Company" }] }), "w", "u", "company")).resolves.toBeUndefined();
  });
  it("requires client type only when the workspace has client types", async () => {
    await expect(assertCustomerType(client({ "customer_type": [{}] }), "w", "")).rejects.toThrow("Client type is required");
    await expect(assertCustomerType(client({}), "w", "")).resolves.toBeUndefined();
  });
});
