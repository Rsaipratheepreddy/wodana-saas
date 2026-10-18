import { describe, expect, it } from "vitest";
import { e164, INVITE_RESEND_SECONDS, inviteTokenHash, newInviteToken, readClientAccess, type ClientAccess } from "./portal-invitations";
import type { PortalSettings, ProjectAccess } from "./portal-settings";

const settings = (enabled = true): PortalSettings => ({
  workspaceId: "w", slug: "studio", enabled, version: 1,
  sections: { progress: true, decisions: true, payments: true, documents: true, warranty: true, messages: true },
  progress: { stageNames: true, dates: true, updates: true, photos: true }, invoiceAmounts: true, welcomeTitle: "", welcomeText: "", support: { phone: "", email: "", whatsapp: "" },
});
const access = (paused = false): ProjectAccess => ({ sections: null, paused, pausedAt: paused ? "2026-09-27" : null, version: 1 });

type Party = { partyId: string; name: string; email: string | null; phone: string | null; country: string | null; locale: string };
type Grant = { id: string; name: string; phone: string; email: string | null; active: boolean; version: number; lastVisitAt: Date | null };
type Invitation = { id: string; email: string; sentAt: Date; expiresAt: Date; delivery: "sent" | "failed"; revokedAt: Date | null };

/** The three reads behind the client's access, answered from memory. */
function db(rows: { party?: Party; grant?: Grant; invitation?: Invitation }) {
  return { query: async (text: string) => ({ rows:
    text.includes("FROM pre_project_cases") ? (rows.party ? [rows.party] : [])
      : text.includes("FROM client_portal_grants grant_row") ? (rows.grant ? [rows.grant] : [])
        : text.includes("FROM client_portal_invitations") ? (rows.invitation ? [rows.invitation] : []) : [] }) } as never;
}
const read = (rows: Parameters<typeof db>[0], on = settings(), project = access()) =>
  readClientAccess(db(rows), { workspaceId: "w", projectId: "p", caseId: "c", settings: on, access: project });

const maya: Party = { partyId: "party-1", name: "Maya Client", email: "client@palmliving.test", phone: "+15550100001", country: null, locale: "en-AE" };
const grant = (patch: Partial<Grant> = {}): Grant => ({ id: "g1", name: "Maya Client", phone: "+15550100001", email: "client@palmliving.test", active: true, version: 3, lastVisitAt: null, ...patch });
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
const invitation = (patch: Partial<Invitation> = {}): Invitation => ({ id: "i1", email: "client@palmliving.test", sentAt: minutesAgo(1), expiresAt: new Date(Date.now() + 86_400_000), delivery: "sent", revokedAt: null, ...patch });

describe("client portal invitations", () => {
  it("reads the client's number in international form however the CRM holds it", () => {
    expect(e164("050 010 0001", "AE")).toBe("+971500100001");
    expect(e164("+1 (202) 555-0123", null)).toBe("+12025550123");
    expect(e164("2025550123", "US")).toBe("+12025550123");
    expect(e164("123", "AE")).toBeNull();
    expect(e164("not a number", null)).toBeNull();
    expect(e164(null, "AE")).toBeNull();
  });

  it("makes an unguessable link token and stores only its hash", () => {
    const token = newInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newInviteToken()).not.toBe(token);
    expect(inviteTokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(inviteTokenHash(token)).toBe(inviteTokenHash(token));
  });

  it("says what stops an invite, in the order staff can fix it", async () => {
    expect(await read({ party: maya }, settings(false))).toMatchObject({ status: "not_invited", blocked: "portal_off" });
    expect(await read({ party: maya }, settings(), access(true))).toMatchObject({ blocked: "paused" });
    expect(await read({})).toMatchObject({ name: null, blocked: "no_client" });
    expect(await read({ party: { ...maya, phone: null } })).toMatchObject({ name: "Maya Client", partyId: "party-1", blocked: "no_phone" });
    expect(await read({ party: { ...maya, email: null } })).toMatchObject({ phone: "+15550100001", blocked: "no_email" });
    // A contact added by hand with an email fills in what the CRM lacks.
    expect(await read({ party: { ...maya, email: null }, grant: grant() })).toMatchObject({ email: "client@palmliving.test", blocked: null });
    expect(await read({ party: maya })).toMatchObject({ status: "not_invited", grantId: null, version: 0, blocked: null, resendAfter: 0 });
  });

  it("shows invited (and when another invite may go), active since the last invite, or revoked", async () => {
    const invited = await read({ party: maya, grant: grant(), invitation: invitation() });
    expect(invited).toMatchObject({ status: "invited", grantId: "g1", version: 3, delivery: "sent" } satisfies Partial<ClientAccess>);
    expect(invited.resendAfter).toBeGreaterThan(0);
    expect(invited.resendAfter).toBeLessThanOrEqual(INVITE_RESEND_SECONDS - 60);
    expect(await read({ party: maya, grant: grant(), invitation: invitation({ sentAt: minutesAgo(3) }) })).toMatchObject({ status: "invited", resendAfter: 0 });
    expect(await read({ party: maya, grant: grant({ lastVisitAt: minutesAgo(0) }), invitation: invitation() })).toMatchObject({ status: "active", resendAfter: expect.any(Number) });
    // Invited again after their last visit: they're invited until they come back.
    expect(await read({ party: maya, grant: grant({ lastVisitAt: minutesAgo(10) }), invitation: invitation() })).toMatchObject({ status: "invited", lastVisitAt: expect.any(String) });
    expect(await read({ party: maya, grant: grant({ lastVisitAt: minutesAgo(10) }) })).toMatchObject({ status: "active" });
    expect(await read({ party: maya, grant: grant({ active: false, lastVisitAt: minutesAgo(10) }), invitation: invitation({ revokedAt: minutesAgo(1) }) }))
      .toMatchObject({ status: "revoked", lastVisitAt: null, invitedAt: null, resendAfter: 0 });
    // A contact added by hand, never invited, never in.
    expect(await read({ party: maya, grant: grant() })).toMatchObject({ status: "not_invited", grantId: "g1" });
  });
});
