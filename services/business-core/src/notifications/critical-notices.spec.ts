import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_NOTIFICATION_TEMPLATES, notifyUserInApp, queueUserEmail, queueUserPush, queueUserPushFromTemplate, REMINDER_TEMPLATES,
} from "./default-templates";
import { ENGINE_REMINDER_KINDS, REMINDER_KIND_INFO } from "../reminders/reminders-contract";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

/**
 * A fake tenant client: the person switched this notice's group off on every channel (and, with `pushSwitch`, has the
 * phone's own push switch on; `device` says whether a phone is registered).
 */
function mutedDb(options: { pushSwitch: boolean; device?: boolean }) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const device = options.device !== false;
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.includes("FROM notification_channel_choices")) {
      return { rows: [{ userId, membershipId: "m", groupSwitches: { in_app: false, email: false, push: false, whatsapp: false }, eventSwitches: [],
        pushSwitch: options.pushSwitch, pushDevice: device, workspacePush: device, workspaceWhatsapp: false }], rowCount: 1 };
    }
    if (sql.includes("FROM notification_templates")) return { rows: [{ id: "template", subject: "{{title}} · {{due}}", body: "{{context}}." }], rowCount: 1 };
    if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: "n-1", correlationId: "c" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  return { db: { query }, calls };
}

const message = (critical?: boolean) => ({
  workspaceId, recipientUserId: userId, code: "reminders.invoice.overdue", eventType: "invoice.overdue",
  variables: { title: "INV-0004", context: "Villa 4", due: "7 days overdue" }, deepLink: "/workspace/finance/invoices/i", idempotencyKey: "rem:s:u:in_app",
  ...(critical === undefined ? {} : { critical }),
});
const inserted = (calls: Array<{ sql: string; values: unknown[] }>) => calls.filter((call) => call.sql.includes("INSERT INTO notifications"));
/** The in-app insert's critical flag (before the silent flag). */
const criticalOf = (call: { values: unknown[] }) => call.values.at(-2);

describe("critical notices ignore mutes (R13)", () => {
  it("in the app: a muted event is dropped, unless it is critical, which is marked critical and also goes by the fastest channel", async () => {
    const muted = mutedDb({ pushSwitch: false });
    await expect(notifyUserInApp(muted.db, message())).resolves.toEqual({ queued: false, reason: "recipient_preference" });
    expect(inserted(muted.calls)).toEqual([]);
    const critical = mutedDb({ pushSwitch: false });
    await expect(notifyUserInApp(critical.db, message(true))).resolves.toEqual({ queued: true });
    const [inApp, email] = inserted(critical.calls);
    expect(inApp.sql).toContain("'in_app'");
    expect(criticalOf(inApp)).toBe(true);
    // No phone: the alert also goes by email, the person's fastest channel.
    expect(email.sql).toContain("'email'");
    expect(email.values.at(-1)).toBe(true);
    const phone = mutedDb({ pushSwitch: true });
    await notifyUserInApp(phone.db, message(true));
    expect(inserted(phone.calls).map((call) => call.sql.includes("'push'") ? "push" : call.sql.includes("'email'") ? "email" : "in_app")).toEqual(["in_app", "push"]);
  });

  it("by email: the same", async () => {
    const muted = mutedDb({ pushSwitch: false });
    await expect(queueUserEmail(muted.db, message(false))).resolves.toEqual({ queued: false, reason: "recipient_preference" });
    const critical = mutedDb({ pushSwitch: false });
    await expect(queueUserEmail(critical.db, message(true))).resolves.toEqual({ queued: true });
    const row = inserted(critical.calls)[0];
    expect(row.sql).toContain("critical)");
    expect(row.values.at(-1)).toBe(true);
  });

  it("on the phone: the group mute is ignored, the phone's own switch and the device never are", async () => {
    const push = (critical: boolean, pushSwitch = true, device = true) => {
      const fake = mutedDb({ pushSwitch, device });
      return { fake, result: queueUserPush(fake.db, { workspaceId, recipientUserId: userId, eventType: "invoice.overdue", subject: "s", body: "b", idempotencyKey: "k", critical }) };
    };
    await expect(push(false).result).resolves.toEqual({ queued: false, reason: "push_off" });
    const critical = push(true);
    await expect(critical.result).resolves.toEqual({ queued: true });
    expect(inserted(critical.fake.calls)[0].values.at(-1)).toBe(true);
    await expect(push(true, false).result).resolves.toEqual({ queued: false, reason: "push_off" });
    await expect(push(true, true, false).result).resolves.toEqual({ queued: false, reason: "no_device" });
  });

  it("from a push template: the mute is skipped only for a critical notice", async () => {
    const plain = mutedDb({ pushSwitch: true });
    await expect(queueUserPushFromTemplate(plain.db, message())).resolves.toEqual({ queued: false, reason: "push_off" });
    expect(inserted(plain.calls)).toEqual([]);
    const critical = mutedDb({ pushSwitch: true });
    await expect(queueUserPushFromTemplate(critical.db, message(true))).resolves.toEqual({ queued: true });
    expect(inserted(critical.calls)[0].values.at(-1)).toBe(true);
    const off = mutedDb({ pushSwitch: false });
    await expect(queueUserPushFromTemplate(off.db, message(true))).resolves.toEqual({ queued: false, reason: "push_off" });
  });

  it("keeps existing callers as they were: no flag means not critical", async () => {
    const fake = mutedDb({ pushSwitch: true });
    fake.db.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM notification_templates")) return { rows: [{ id: "template", subject: null, body: "Hello" }], rowCount: 1 };
      if (sql.includes("FROM notification_channel_choices")) return { rows: [], rowCount: 0 };
      return { rows: [{ id: "n", correlationId: "c" }], rowCount: 1 };
    });
    await notifyUserInApp(fake.db, { workspaceId, recipientUserId: userId, code: "project.started", eventType: "project.started", variables: {}, idempotencyKey: "k" });
    const call = fake.db.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO notifications"));
    expect(criticalOf({ values: call?.[1] as unknown[] })).toBe(false);
  });
});

describe("reminder templates", () => {
  const codes = (channel: string) => new Set(REMINDER_TEMPLATES.filter((template) => template.channel === channel).map((template) => template.code));

  it("cover every kind the engine sends, staff in the app, on the phone and by email, clients by email", () => {
    for (const kind of ENGINE_REMINDER_KINDS) {
      const code = `reminders.${kind}`;
      if (REMINDER_KIND_INFO[kind].audience === "staff") for (const channel of ["in_app", "push", "email"]) expect(codes(channel), `${code} ${channel}`).toContain(code);
      else expect(codes("email"), code).toContain(code);
    }
    for (const code of ["reminders.client.quote_decision.staff", "reminders.client.design_decision.staff", "reminders.escalated"]) {
      for (const channel of ["in_app", "push", "email"]) expect(codes(channel), `${code} ${channel}`).toContain(code);
    }
    for (const code of ["reminders.digest", "reminders.unreachable", "reminders.delivery_failed"]) {
      for (const channel of ["in_app", "email"]) expect(codes(channel), `${code} ${channel}`).toContain(code);
    }
  });

  it("are seeded with every workspace, declare what they use and read plainly", () => {
    const keys = new Set(DEFAULT_NOTIFICATION_TEMPLATES.map((template) => `${template.code}:${template.channel}`));
    expect(keys.size).toBe(DEFAULT_NOTIFICATION_TEMPLATES.length);
    for (const template of REMINDER_TEMPLATES) {
      expect(keys).toContain(`${template.code}:${template.channel}`);
      const used = [...`${template.subject ?? ""} ${template.body}`.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)].map((match) => match[1]);
      for (const name of used) expect(template.variables, `${template.code} ${name}`).toContain(name);
      // No dashes as punctuation.
      expect(`${template.subject} ${template.body}`, template.code).not.toMatch(/ [-–—] |[–—]/);
      expect(template.code.length).toBeLessThanOrEqual(100);
    }
  });
});
