import { describe, expect, it, vi } from "vitest";
import { demoCodeInput, PortalCodes, sendCode, setDemoCode, useCode, type Delivery } from "./portal-auth";

const codes = new PortalCodes("s".repeat(40), false);
const GRANT = "11111111-1111-4111-8111-111111111111", OTHER = "22222222-2222-4222-8222-222222222222", CHALLENGE = "33333333-3333-4333-8333-333333333333";
const PHONE = "+971501234567";

/** The portal's reads and writes, answered from memory: grants by number, one challenge, and what was written. */
function db(state: { grants: Array<{ id: string; phone: string; hash: string | null }>; challenge?: { phone: string; attempts: number; expired?: boolean } }) {
  const writes: string[] = [];
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    if (text.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 0 };
    if (text.includes("count(*) FILTER")) return { rows: [{ number: 0, requester: 0, total: 0, last: null }], rowCount: 1 };
    if (text.includes("FROM client_portal_grants WHERE workspace_id = $1 AND phone = $2 AND active AND demo_code_hash IS NOT NULL"))
      return { rows: state.grants.filter((grant) => grant.phone === values[1] && grant.hash).map(({ id, hash }) => ({ id, hash })), rowCount: 1 };
    if (text.includes("FROM client_portal_grants WHERE workspace_id = $1 AND phone = $2 AND active"))
      return { rows: state.grants.filter((grant) => grant.phone === values[1]).map((grant) => ({ id: grant.id, caseId: "c", name: "Demo", role: "approver", email: null, confirmed: false, demo: Boolean(grant.hash) })), rowCount: 1 };
    if (text.includes("SELECT phone, demo_code_hash AS hash FROM client_portal_grants")) {
      const grant = state.grants.find((row) => row.id === values[1]);
      return { rows: grant ? [{ phone: grant.phone, hash: grant.hash }] : [], rowCount: grant ? 1 : 0 };
    }
    if (text.includes("SET demo_code_hash = $3")) { state.grants.find((row) => row.id === values[1])!.hash = values[2] as string | null; writes.push("demo_code"); return { rows: [], rowCount: 1 }; }
    if (text.includes("FROM client_portal_challenges WHERE workspace_id = $1 AND id = $2 FOR UPDATE")) {
      const challenge = state.challenge;
      return challenge ? { rows: [{ phone: challenge.phone, purpose: "sign_in", code_hash: codes.hash(CHALLENGE, "654321"), attempts: challenge.attempts,
        expires_at: new Date(Date.now() + (challenge.expired ? -1 : 60_000)), consumed_at: null }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (text.includes("SET attempts = attempts + 1")) { state.challenge!.attempts += 1; return { rows: [], rowCount: 1 }; }
    if (text.includes("SET consumed_at = now() WHERE workspace_id = $1 AND id = $2")) { writes.push("consumed"); return { rows: [], rowCount: 1 }; }
    if (text.includes("INSERT INTO client_portal_challenges")) { writes.push(`challenge:${values[4]}`); return { rows: [], rowCount: 1 }; }
    if (text.includes("UPDATE client_portal_sessions SET revoked_at")) { writes.push("sessions_ended"); return { rows: [], rowCount: 2 }; }
    return { rows: [], rowCount: 0 };
  });
  return { query, writes } as { query: typeof query; writes: string[] };
}

describe("client portal demonstration code", () => {
  it("takes exactly six digits", () => {
    expect(demoCodeInput("123456")).toBe("123456");
    expect(demoCodeInput(" 123 456 ")).toBe("123456");
    for (const bad of ["12345", "1234567", "12345a", "", null, 123456]) expect(() => demoCodeInput(bad)).toThrow(/six-digit/);
  });

  it("stores the code only as a hash bound to the contact, and the same code again changes nothing", async () => {
    expect(codes.demoHash(GRANT, "123456")).not.toBe(codes.demoHash(OTHER, "123456"));
    expect(codes.demoHash(GRANT, "123456")).not.toBe(codes.hash(GRANT, "123456"));
    const state = { grants: [{ id: GRANT, phone: PHONE, hash: null as string | null }] };
    const store = db(state);
    expect(await setDemoCode(store as never, "w", codes, { grantId: GRANT, code: "123456", userId: "u" })).toEqual({ changed: true, demo: true, ended: 0 });
    expect(state.grants[0].hash).toBe(codes.demoHash(GRANT, "123456"));
    expect(await setDemoCode(store as never, "w", codes, { grantId: GRANT, code: "123456", userId: "u" })).toEqual({ changed: false, demo: true, ended: 0 });
    expect(store.writes.filter((write) => write === "demo_code")).toHaveLength(1);
    // Clearing ends the contact's sessions; clearing again changes nothing.
    expect(await setDemoCode(store as never, "w", codes, { grantId: GRANT, code: null, userId: "u" })).toEqual({ changed: true, demo: false, ended: 2 });
    expect(store.writes).toContain("sessions_ended");
    expect(await setDemoCode(store as never, "w", codes, { grantId: GRANT, code: null, userId: "u" })).toEqual({ changed: false, demo: false, ended: 0 });
    expect(await setDemoCode(store as never, "w", codes, { grantId: OTHER, code: "123456", userId: "u" })).toBeNull();
  });

  it("sends nothing to a number with a demonstration code, and gives it a code nobody receives", async () => {
    const delivery: Delivery = { whatsapp: vi.fn(async () => undefined), email: vi.fn(async () => true) };
    const demo = db({ grants: [{ id: GRANT, phone: PHONE, hash: codes.demoHash(GRANT, "123456") }] });
    const sent = await sendCode(demo as never, "w", codes, delivery, { phone: PHONE, channel: "whatsapp", purpose: "sign_in", requester: null });
    expect(sent.challengeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(delivery.whatsapp).not.toHaveBeenCalled();
    expect(delivery.email).not.toHaveBeenCalled();
    // The stored challenge hash is not the hash of any six-digit code: only the demonstration code opens it.
    const stored = demo.writes.find((write) => write.startsWith("challenge:"))!.slice("challenge:".length);
    expect(stored).not.toBe(codes.hash(sent.challengeId, "123456"));
    // An ordinary contact still gets their code by WhatsApp.
    const ordinary = db({ grants: [{ id: OTHER, phone: "+971509999999", hash: null }] });
    await sendCode(ordinary as never, "w", codes, delivery, { phone: "+971509999999", channel: "whatsapp", purpose: "sign_in", requester: null });
    expect(delivery.whatsapp).toHaveBeenCalledTimes(1);
  });

  it("accepts the demonstration code against the number's own challenge, counts wrong tries, and never for another number", async () => {
    const state = { grants: [{ id: GRANT, phone: PHONE, hash: codes.demoHash(GRANT, "123456") }], challenge: { phone: PHONE, attempts: 0 } };
    const store = db(state);
    expect(await useCode(store as never, "w", codes, { challengeId: CHALLENGE, code: "111111", purpose: "sign_in" })).toBeNull();
    expect(state.challenge.attempts).toBe(1);
    expect(await useCode(store as never, "w", codes, { challengeId: CHALLENGE, code: "123456", purpose: "sign_in" })).toBe(PHONE);
    expect(store.writes).toContain("consumed");
    // Five wrong tries lock the challenge even for the right demonstration code.
    state.challenge.attempts = 5;
    expect(await useCode(store as never, "w", codes, { challengeId: CHALLENGE, code: "123456", purpose: "sign_in" })).toBeNull();
    // Another number's challenge: 123456 is not its code.
    const stranger = db({ grants: [{ id: OTHER, phone: "+971509999999", hash: null }], challenge: { phone: "+971509999999", attempts: 0 } });
    expect(await useCode(stranger as never, "w", codes, { challengeId: CHALLENGE, code: "123456", purpose: "sign_in" })).toBeNull();
    // Without a demonstration code, only the delivered code works.
    const cleared = db({ grants: [{ id: GRANT, phone: PHONE, hash: null }], challenge: { phone: PHONE, attempts: 0 } });
    expect(await useCode(cleared as never, "w", codes, { challengeId: CHALLENGE, code: "123456", purpose: "sign_in" })).toBeNull();
    expect(await useCode(cleared as never, "w", codes, { challengeId: CHALLENGE, code: "654321", purpose: "sign_in" })).toBe(PHONE);
  });
});
