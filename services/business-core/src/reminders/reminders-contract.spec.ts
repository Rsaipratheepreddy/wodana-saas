import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as shared from "../../../../packages/contracts/src/reminders";
import * as local from "./reminders-contract";

const core = readFileSync(resolve(__dirname, "../../drizzle/0289_reminders_core.sql"), "utf8");
/** 0306 re-adds the kind lists with change_request.client_decision: the latest definition of a constraint wins. */
const engine = readFileSync(resolve(__dirname, "../../drizzle/0306_reminders_engine.sql"), "utf8");
const migration = core;
/**
 * Later migrations extend a kind list without rewriting it (so a kind another release added stays), and say so in a
 * line read here: `-- adds to <constraint>: 'kind', …` (0330 adds meeting.minutes_due).
 */
const drizzle = resolve(__dirname, "../../drizzle");
const later = readdirSync(drizzle).filter((name) => /^\d{4}_.+\.sql$/.test(name) && name > "0306").sort().map((name) => readFileSync(resolve(drizzle, name), "utf8"));
const added = (constraint: string) => later.flatMap((sql) => [...sql.matchAll(new RegExp(String.raw`-- adds to ${constraint}: ([^\n]*)`, "g"))]
  .flatMap((match) => [...match[1].matchAll(/'([a-z_.]+)'/g)].map((value) => value[1])));
/** The quoted values of a named CHECK constraint (an IN list or an ARRAY[...]), from its latest definition, with the kinds added since. */
const checkList = (constraint: string, column: string) => {
  const source = engine.includes(`CONSTRAINT ${constraint} CHECK`) ? engine : core;
  const start = source.indexOf(`CONSTRAINT ${constraint} CHECK`);
  if (start < 0) return [];
  const list = new RegExp(String.raw`${column} (?:IN \(|<@ ARRAY\[)([^)\]]*)[)\]]`).exec(source.slice(start));
  const base = list ? [...list[1].matchAll(/'([a-z_.]+)'/g)].map((value) => value[1]) : [];
  return [...base, ...added(constraint).filter((value, index, all) => !base.includes(value) && all.indexOf(value) === index)];
};

describe("reminder contract", () => {
  it("is the same in business-core as in packages/contracts", () => {
    for (const name of [
      "ENGINE_REMINDER_KINDS", "MY_DAY_ONLY_KINDS", "REMINDER_KINDS", "REMINDER_MODULES", "REMINDER_AUDIENCES", "REMINDER_UNITS", "REMINDER_CHAIN_LINKS",
      "REMINDER_CHANNELS", "REMINDER_SUBJECT_STATUSES", "REMINDER_DONE_REASONS", "REMINDER_STEP_KINDS", "REMINDER_STEP_STATES", "REMINDER_SKIP_REASONS",
      "REMINDER_HOLD_REASONS", "CLIENT_REMINDER_PRIORITY", "REMINDER_KIND_INFO", "REMINDER_KIND_DEFAULTS", "REMINDER_RULE_LIMITS", "REMINDER_SETTINGS_DEFAULTS",
      "MAX_SNOOZE_DAYS", "REMINDER_PERMISSIONS", "CLIENT_DECISION_KINDS", "WAITING_REMINDER_KINDS", "CRITICAL_REMINDER_EVENT_TYPES",
    ] as const) {
      expect((local as Record<string, unknown>)[name], name).toEqual((shared as Record<string, unknown>)[name]);
    }
    expect(local.reminderStepKey.remind(-2)).toBe(shared.reminderStepKey.remind(-2));
    expect(local.reminderStepKey.escalate(1)).toBe("e:1");
    expect(local.reminderTemplateCode.kind("work.due")).toBe(shared.reminderTemplateCode.kind("work.due"));
    expect(local.reminderTemplateCode.staffCopy("client.quote_decision")).toBe("reminders.client.quote_decision.staff");
  });

  it("matches the database's lists", () => {
    expect(checkList("reminder_rules_kind_check", "kind")).toEqual([...shared.ENGINE_REMINDER_KINDS]);
    expect(checkList("reminder_subjects_kind_check", "kind").sort()).toEqual([...shared.REMINDER_KINDS].sort());
    expect(checkList("reminder_rules_unit_check", "unit")).toEqual([...shared.REMINDER_UNITS]);
    expect(checkList("reminder_rules_chain_check", "chain")).toEqual([...shared.REMINDER_CHAIN_LINKS]);
    expect(checkList("reminder_rules_channels_check", "channels")).toEqual([...shared.REMINDER_CHANNELS]);
    expect(checkList("reminder_subjects_audience_check", "audience")).toEqual([...shared.REMINDER_AUDIENCES]);
    expect(checkList("reminder_subjects_status_check", "status")).toEqual([...shared.REMINDER_SUBJECT_STATUSES]);
    expect(checkList("reminder_subjects_done_reason_check", "done_reason")).toEqual([...shared.REMINDER_DONE_REASONS]);
    expect(checkList("reminder_steps_kind_check", "kind")).toEqual([...shared.REMINDER_STEP_KINDS]);
    expect(checkList("reminder_steps_state_check", "state")).toEqual([...shared.REMINDER_STEP_STATES]);
    expect(checkList("reminder_steps_skip_reason_check", "skip_reason")).toEqual([...shared.REMINDER_SKIP_REASONS]);
    expect(checkList("reminder_steps_hold_reason_check", "hold_reason")).toEqual([...shared.REMINDER_HOLD_REASONS]);
    expect(migration).toContain(`('${shared.REMINDER_PERMISSIONS.manage}',`);
    expect(migration).toContain(`('${shared.REMINDER_PERMISSIONS.team}',`);
  });

  it("gives every kind a module, an audience and a sender, and every engine kind a valid default rule", () => {
    expect(new Set(shared.REMINDER_KINDS).size).toBe(shared.REMINDER_KINDS.length);
    for (const kind of shared.REMINDER_KINDS) {
      const info = shared.REMINDER_KIND_INFO[kind];
      expect(shared.REMINDER_MODULES, kind).toContain(info.module);
      expect(info.notify === "engine", kind).toBe(shared.isEngineReminderKind(kind));
      expect(info.eventType === null, kind).toBe(info.notify === "module");
    }
    for (const kind of shared.ENGINE_REMINDER_KINDS) {
      const rule = shared.REMINDER_KIND_DEFAULTS[kind];
      const info = shared.REMINDER_KIND_INFO[kind];
      expect(rule.offsets.length, kind).toBeGreaterThanOrEqual(1);
      expect(rule.offsets.length, kind).toBeLessThanOrEqual(shared.REMINDER_RULE_LIMITS.maxOffsets);
      expect([...rule.offsets].sort((a, b) => a - b), kind).toEqual([...rule.offsets]);
      for (const offset of rule.offsets) expect(Math.abs(offset), kind).toBeLessThanOrEqual(shared.REMINDER_RULE_LIMITS.offsetRange[rule.unit]);
      expect(rule.chain.length, kind).toBeLessThanOrEqual(shared.REMINDER_RULE_LIMITS.maxChain);
      // Staff go in the app, on the phone and by email; clients on WhatsApp, then email.
      expect(rule.channels, kind).toEqual(info.audience === "staff" ? ["in_app", "push", "email"] : ["whatsapp", "email"]);
      expect(rule.priority === null, kind).toBe(info.audience === "staff");
    }
  });

  it("keeps the spec's cadences, critical kinds and client priorities", () => {
    const defaults = shared.REMINDER_KIND_DEFAULTS;
    expect(defaults["work.due"]).toMatchObject({ offsets: [-1, 0, 1, 3], unit: "day", escalateAfter: 2 });
    expect(defaults["approval.waiting"]).toMatchObject({ offsets: [24, 48], unit: "hour", escalateAfter: 2 });
    expect(defaults["payment.due"]).toMatchObject({ offsets: [-3, 0, 3, 7], escalateAfter: null, priority: 1 });
    expect(defaults["client.quote_decision"]).toMatchObject({ offsets: [2, 5], priority: 2 });
    expect(defaults["permit.expiry"]).toMatchObject({ offsets: [-3, -1, 0], workingDays: true, escalateAfter: 1 });
    expect(defaults["quote.expiring"]).toMatchObject({ offsets: [-3, 0], escalateAfter: null });
    expect(shared.ENGINE_REMINDER_KINDS.filter((kind) => shared.REMINDER_KIND_INFO[kind].critical))
      .toEqual(["approval.waiting", "payment.due", "invoice.overdue", "payables.due", "permit.expiry"]);
    // A muted module stops its kinds: the event type starts with the module prefix Settings › Notifications mutes.
    expect(shared.REMINDER_KIND_INFO["work.due"].eventType?.split(".")[0]).toBe("work");
  });

  it("links My day, settings and the API", () => {
    expect(shared.myDayHref()).toBe("/workspace/my-day");
    expect(shared.myDayHref({ scope: "me", urgency: "overdue" })).toBe("/workspace/my-day?urgency=overdue");
    expect(shared.myDayHref({ scope: "team", module: "projects" })).toBe("/workspace/my-day?scope=team&module=projects");
    expect(shared.reminderHref.settings("work.due")).toBe("/workspace/settings/reminders?kind=work.due");
    expect(shared.reminderHref.deliveryHealth()).toBe("/workspace/settings/delivery");
    expect(shared.reminderApi.myDay("w", { scope: "team", limit: 50 })).toBe("/workspaces/w/my-day?scope=team&limit=50");
    expect(shared.reminderApi.snooze("w", "s")).toBe("/workspaces/w/my-day/s/snooze");
    expect(shared.reminderApi.subjects("w", "work:1:m")).toBe("/workspaces/w/reminders/subjects?sourceKey=work%3A1%3Am");
    expect(shared.reminderApi.rule("w", "payment.due")).toBe("/workspaces/w/reminders/rules/payment.due");
    expect(shared.reminderApi.personSettings("w")).toBe("/workspaces/w/notification-person-settings/me");
  });
});
