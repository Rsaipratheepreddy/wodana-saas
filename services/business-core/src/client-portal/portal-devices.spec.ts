import { describe, expect, it } from "vitest";
import { deliverableDevices, deviceInput, optOutDevice, registerDevice, type TokenStore } from "./portal-devices";
import type { PortalContact } from "./portal-auth";

const contact: PortalContact = { sessionId: "5e55107a-0000-4000-8000-000000000001", phone: "+15550100001", name: "Maya", nameConfirmed: true,
  grants: [{ id: "g1", caseId: "c1", name: "Maya", role: "approver", email: null, confirmed: true, demo: false }] };
const body = (patch: Record<string, unknown> = {}) => ({ consent: true, requestId: "8d0f3a52-1111-4000-8000-000000000001", installationId: "1a2b3c4d-2222-4000-8000-000000000002",
  platform: "ios", token: "ExponentPushToken[abcDEF123456]", locale: "ar-AE", timezone: "Asia/Dubai", ...patch });

/** A database that answers by the start of each statement and remembers what ran. */
function fakeDb(answers: Record<string, unknown[]> = {}) {
  const ran: Array<{ text: string; values: unknown[] }> = [];
  return { ran, query: async (text: string, values: unknown[] = []) => {
    ran.push({ text, values });
    const key = Object.keys(answers).find((prefix) => text.replace(/\s+/g, " ").includes(prefix));
    const rows = key ? answers[key] : [];
    return { rows, rowCount: rows.length };
  } } as never as { ran: Array<{ text: string; values: unknown[] }>; query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }> };
}
function store() {
  const kept = new Map<string, string>();
  let next = 0;
  const api: TokenStore & { kept: Map<string, string> } = {
    kept, put: async (_workspace, _owner, token) => { const reference = `ref-${++next}`; kept.set(reference, token); return reference; },
    delete: async (reference) => { if (reference) kept.delete(reference); },
  };
  return api;
}

describe("client portal devices", () => {
  it("registers only after the client said yes in the app, with a real push address", () => {
    expect(deviceInput(body())).toMatchObject({ platform: "ios", locale: "ar-AE", timezone: "Asia/Dubai" });
    expect(() => deviceInput(body({ consent: false }))).toThrow("Turn on notifications");
    expect(() => deviceInput(body({ consent: "yes" }))).toThrow("Turn on notifications");
    expect(() => deviceInput(body({ token: "not-a-token" }))).toThrow("notification address");
    expect(() => deviceInput(body({ platform: "web" }))).toThrow("iPhone and Android");
    expect(() => deviceInput(body({ installationId: "x" }))).toThrow("Try that again");
    expect(() => deviceInput(body({ timezone: "Mars/Olympus" }))).toThrow("Try that again");
  });

  it("keeps the token in the secure store, only its hash and reference in the database, under the current session", async () => {
    const db = fakeDb({ "SELECT consented_at": [{ consentedAt: new Date(), optedOutAt: null, live: true }] });
    const tokens = store();
    const result = await registerDevice(db as never, "w", contact, tokens, deviceInput(body()));
    expect(result).toMatchObject({ registered: true, replayed: false });
    const insert = db.ran.find((entry) => entry.text.includes("INSERT INTO client_portal_devices"))!;
    expect(insert.values).toContain(contact.sessionId);
    expect(insert.values).not.toContain("ExponentPushToken[abcDEF123456]");
    expect(insert.values).toContain("ref-1");
    expect([...tokens.kept.values()]).toEqual(["ExponentPushToken[abcDEF123456]"]);
    // Turning notices back on after an opt-out is a fresh consent.
    expect(insert.text).toMatch(/opted_out_at IS NULL THEN client_portal_devices.consented_at ELSE now\(\)/);
  });

  it("moves a token another install held, drops the replaced one, and treats a repeat request as done", async () => {
    const db = fakeDb({ "UPDATE client_portal_devices device SET token_hash = NULL": [{ reference: "old-other" }], "SELECT encrypted_token_reference AS reference": [{ reference: "old-mine" }] });
    const tokens = store();
    tokens.kept.set("old-other", "t1"); tokens.kept.set("old-mine", "t2");
    await registerDevice(db as never, "w", contact, tokens, deviceInput(body()));
    expect([...tokens.kept.keys()]).toEqual(["ref-1"]);
    const again = fakeDb({ "AND last_request_id = $4": [{ one: 1 }] });
    const quiet = store();
    expect(await registerDevice(again as never, "w", contact, quiet, deviceInput(body()))).toMatchObject({ replayed: true });
    expect(quiet.kept.size).toBe(0);
  });

  it("forgets the token when a write fails, so nothing is left in the store", async () => {
    const tokens = store();
    const failing = { query: async (text: string) => { if (text.includes("INSERT INTO")) throw new Error("boom"); return { rows: [], rowCount: 0 }; } };
    await expect(registerDevice(failing as never, "w", contact, tokens, deviceInput(body()))).rejects.toThrow("boom");
    expect(tokens.kept.size).toBe(0);
  });

  it("remembers an opt-out and drops the token", async () => {
    const db = fakeDb({ "UPDATE client_portal_devices device SET opted_out_at": [{ reference: "ref-9" }], "SELECT consented_at": [{ consentedAt: new Date(), optedOutAt: new Date(), live: false }] });
    const tokens = store();
    tokens.kept.set("ref-9", "t");
    expect(await optOutDevice(db as never, "w", contact, tokens, body().installationId)).toMatchObject({ registered: false, optedOutAt: expect.any(Date) });
    expect(tokens.kept.size).toBe(0);
    await expect(optOutDevice(db as never, "w", contact, tokens, "nope")).rejects.toThrow("Try that again");
  });

  it("reaches a phone only while its session is live, the contact still has access and they haven't opted out", async () => {
    const db = fakeDb();
    await deliverableDevices(db as never, "w", contact.phone);
    const sql = db.ran[0].text.replace(/\s+/g, " ");
    expect(sql).toContain("JOIN client_portal_sessions session");
    expect(sql).toContain("session.revoked_at IS NULL AND session.expires_at > now()");
    expect(sql).toContain("device.opted_out_at IS NULL");
    expect(sql).toContain("grant_row.active");
  });
});
