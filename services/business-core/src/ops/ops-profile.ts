import { FURNITURE_PATHS } from "../crm/opportunities/flow-gates";
import { parseInspectionStages, type InspectionStage } from "../factory/factory-inspections";
import { PRODUCTION_STEP_KINDS, type ProductionStep } from "../factory/production-status";
import { DEDUCT_EVENTS, LEAD_FROM, RESERVE_EVENTS } from "../fulfilment/fulfilment-rules";
import { CHECK_KINDS } from "../project-core/project-checks";
import { QS_ITEM_TYPES, QS_SCOPES } from "../proposals/qs-requirement";

/**
 * A workspace configuration profile for the operator CLI's `configure` command: generic configuration as data
 * (docs/fixtures/palm-golive-config.json is one). Every section is optional; a section the profile leaves out is
 * not touched. Checked whole before anything is read or written.
 */

export type CheckSpec = { kind: (typeof CHECK_KINDS)[number]; label?: string; role?: string };
export type RouteChange = {
  /** The route by name; or `default: true` for the workspace's default route. */
  route: string | null; isDefault: boolean;
  addStages: Array<{ name: string; key?: string; ownerRole?: string | null; before?: string; after?: string; checks: CheckSpec[] }>;
  addChecks: Array<{ stage: string; checks: CheckSpec[] }>;
  /** Checks taken off a stage (e.g. the site check a design check replaces, PLM-149); a check that isn't there is left as is. */
  removeChecks?: Array<{ stage: string; checks: CheckSpec[] }>;
};
export type OrderPathChange = {
  enquiryType: string; path: (typeof FURNITURE_PATHS)[number] | null;
  boqRequired?: boolean | null; reserveOn?: string; deductOn?: string; takeFrom?: string | null; leadDays?: { min: number; max: number } | null; leadFrom?: string;
};
/**
 * A catalogue's category clean-up, by category name (however it's written: "BED & MATTRESS" finds "Beds & Mattress"
 * when no category is called exactly that). Runs in this order: merge, delete empty, rename, parent.
 */
export type CategoryCleanup = {
  catalog: string;
  merge: Array<{ from: string; into: string }>;
  deleteEmpty: string[];
  /** Deletes every empty category (no items, no sub-categories) named like one that has items. */
  deleteEmptyDuplicates: boolean;
  rename: Array<{ from: string; to: string }>;
  /** A category under another; null puts it at the top level. */
  parent: Array<{ category: string; parent: string | null }>;
};
export type Profile = {
  enquiryTypes?: { archive: string[] };
  vehicles?: Array<{ name: string; plate?: string; type?: string }>;
  factory?: {
    productionSteps?: ProductionStep[]; clientPaymentReminderDays?: number;
    permits?: { requiredForDeliveriesAndInstallations?: boolean; furnitureDeliveriesNeedOne?: boolean; missingAlertWorkingDays?: number; expiryReminderDays?: number };
    /**
     * PLM-150: design inspections of made items: on or off; the stages kept (raw before the final finish, final after
     * finishing) with the firm's names; the trades (work package names) whose items need them; the project role that
     * inspects, the role that inspects instead on projects of the listed design packages (codes); the working days to do it.
     */
    inspections?: { enabled?: boolean; stages?: InspectionStage[]; trades?: string[]; inspectorRole?: string; directorRole?: string | null; directorPackages?: string[];
      workingDays?: number };
  };
  quotations?: { validityDays?: number; qsReview?: boolean; qsPrices?: "all" | "rules"; qsItemTypes?: string[]; qsWorkPackages?: string[]; valueEngineeringFreeRounds?: number | null };
  firstResponse?: { minutes: number; warningMinutes?: number; workingCalendar?: { days: string[]; start: string; end: string; timeZone?: string } };
  financeRequests?: {
    inbox?: string | null; autoStageInvoiceRequests?: boolean;
    paymentMethods?: Array<{ name: string; refundDays?: number | null; guidance?: string; needsBankDetails?: boolean }>;
  };
  approvals?: { payableRequest?: { firstApproverRole: string; secondApproverRole?: string | null; thresholdAmount?: string | null } };
  routes?: RouteChange[];
  rolePermissions?: Array<{ roles: string[]; permissions: string[] }>;
  design?: {
    renderInternalDays?: number | null; renderClientDays?: number | null; revisionsIncluded?: number; packages?: string[];
    /** The design order of 13 Oct 2026 (PLM-140–144, PLM-151): the days of its steps; a key left out keeps its value. */
    steps?: Partial<Record<DesignStepKey, number>> & { conceptOptionsMax?: number | null };
    /** PLM-151: the team role each part of the design team uses (null: not used); a key left out keeps its value. */
    team?: Partial<Record<DesignTeamKey, string | null>>;
    /** The team roles the design team needs on every job (Settings › Projects): added when missing, relabelled when different. */
    projectRoles?: Array<{ key: string; label: string }>;
  };
  orderPaths?: OrderPathChange[];
  clientUpdates?: { mode: "call" | "portal"; frequency: "weekly" | "fortnightly" | "monthly" | "off" };
  catalogCategories?: CategoryCleanup[];
  /**
   * Project settings (PLM-149): the project role that checks the drawings match the design, sends them to the client and
   * records the client's approval (null: the project manager), and the working days the technical measure is due in.
   */
  projects?: { drawingsClientRole?: string | null; technicalMeasureDays?: number | null };
  /**
   * The finishes schedule (PLM-146/148/156/157): the finish categories in order (which the client signs before
   * procurement), whether the final quotation waits for the final specification, the days to send the finishes to QS,
   * the design team parts that edit the quotation's material column, and the sample library's price bands (amounts in
   * the workspace's currency). A part left out keeps its value.
   */
  finishes?: {
    categories?: Array<{ key: string; label: string; clientSignature: boolean }>; specificationGate?: boolean; finishesToQsDays?: number; materialEditors?: string[];
    priceBands?: Array<{ label: string; minAmount: string | null; maxAmount: string | null }>;
  };
};

export const DESIGN_STEP_KEYS = ["allocationDays", "kickoffDays", "conceptDays", "siteMeasureDays", "developmentMinDays", "developmentMaxDays", "developmentDaysPerRoom",
  "sampleCollectionDays", "sampleMeetingDays"] as const;
export type DesignStepKey = (typeof DESIGN_STEP_KEYS)[number];
export const DESIGN_TEAM_KEYS = ["lead_designer", "junior_designer", "sales_admin", "visualiser", "draftsman", "material_coordinator", "technicalLeadRoleCode"] as const;
export type DesignTeamKey = (typeof DESIGN_TEAM_KEYS)[number];

export const PROFILE_SECTIONS = ["enquiryTypes", "vehicles", "factory", "quotations", "firstResponse", "financeRequests", "approvals", "routes", "rolePermissions",
  "design", "orderPaths", "clientUpdates", "catalogCategories", "projects", "finishes"] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];
export const WEEK_DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export class ProfileError extends Error {
  constructor(readonly problems: string[]) { super(`The profile is not valid:\n  - ${problems.join("\n  - ")}`); }
}

type Obj = Record<string, unknown>;
const isObject = (value: unknown): value is Obj => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const word = (text: string) => text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** Validates a parsed profile; every problem is listed at once. */
export function validateProfile(raw: unknown): Profile {
  const problems: string[] = [];
  if (!isObject(raw)) throw new ProfileError(["The profile is a JSON object of sections."]);
  const profile: Profile = {};
  for (const key of Object.keys(raw)) {
    if (key === "$schema" || key === "description" || key.startsWith("_")) continue;
    if (!(PROFILE_SECTIONS as readonly string[]).includes(key)) problems.push(`Unknown section "${key}". Sections: ${PROFILE_SECTIONS.join(", ")}.`);
  }

  const at = (path: string) => ({
    object(value: unknown, keys: string[]): Obj | null {
      if (!isObject(value)) { problems.push(`${path} is an object.`); return null; }
      const extra = Object.keys(value).filter((key) => !keys.includes(key) && !key.startsWith("_"));
      if (extra.length) problems.push(`${path} has unknown keys: ${extra.join(", ")}.`);
      return value;
    },
    int(value: unknown, min: number, max: number): number | undefined {
      if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) { problems.push(`${path} is a whole number from ${min} to ${max}.`); return undefined; }
      return value as number;
    },
    bool(value: unknown): boolean | undefined {
      if (typeof value !== "boolean") { problems.push(`${path} is true or false.`); return undefined; }
      return value;
    },
    text(value: unknown, max: number, allowEmpty = false): string | undefined {
      if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.trim().length > max) {
        problems.push(`${path} is ${allowEmpty ? "" : "non-empty "}text of at most ${max} characters.`); return undefined;
      }
      return value.trim();
    },
    oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
      if (typeof value !== "string" || !allowed.includes(value as T)) { problems.push(`${path} is one of ${allowed.join(", ")}.`); return undefined; }
      return value as T;
    },
    list(value: unknown, max = 200): unknown[] {
      if (!Array.isArray(value)) { problems.push(`${path} is a list.`); return []; }
      if (value.length > max) problems.push(`${path} has at most ${max} entries.`);
      return value;
    },
    texts(value: unknown, max: number): string[] {
      return at(path).list(value).flatMap((entry, index) => { const text = at(`${path}[${index}]`).text(entry, max); return text === undefined ? [] : [text]; });
    },
  });
  const optional = <T>(object: Obj, key: string, read: (value: unknown) => T): T | undefined => (object[key] === undefined ? undefined : read(object[key]));
  const nullable = <T>(object: Obj, key: string, read: (value: unknown) => T): T | null | undefined =>
    object[key] === undefined ? undefined : object[key] === null ? null : read(object[key]);

  const checkSpec = (path: string, value: unknown): CheckSpec | null => {
    if (typeof value === "string") {
      const kind = at(path).oneOf(value, CHECK_KINDS);
      if (kind === "confirm" || kind === "role_assigned") { problems.push(`${path}: a ${kind} check is an object with its ${kind === "confirm" ? "label" : "role"}.`); return null; }
      return kind ? { kind } : null;
    }
    const object = at(path).object(value, ["kind", "label", "role"]);
    if (!object) return null;
    const kind = at(`${path}.kind`).oneOf(object.kind, CHECK_KINDS);
    if (!kind) return null;
    const spec: CheckSpec = { kind };
    if (kind === "confirm") spec.label = at(`${path}.label`).text(object.label, 200);
    else if (object.label !== undefined) problems.push(`${path}.label is only for a confirm check.`);
    if (kind === "role_assigned") spec.role = at(`${path}.role`).text(object.role, 64);
    else if (object.role !== undefined) problems.push(`${path}.role is only for a role_assigned check.`);
    return spec;
  };

  if (raw.enquiryTypes !== undefined) {
    const section = at("enquiryTypes").object(raw.enquiryTypes, ["archive"]);
    if (section) profile.enquiryTypes = { archive: at("enquiryTypes.archive").texts(section.archive ?? [], 80) };
  }

  if (raw.vehicles !== undefined) {
    const seen = new Set<string>();
    profile.vehicles = at("vehicles").list(raw.vehicles, 200).flatMap((entry, index) => {
      const path = `vehicles[${index}]`;
      const object = at(path).object(entry, ["name", "plate", "type"]);
      if (!object) return [];
      const name = at(`${path}.name`).text(object.name, 120);
      if (name && seen.has(name.toLowerCase())) problems.push(`${path}.name repeats "${name}".`);
      if (name) seen.add(name.toLowerCase());
      const plate = optional(object, "plate", (value) => at(`${path}.plate`).text(value, 40, true));
      const type = optional(object, "type", (value) => at(`${path}.type`).text(value, 60, true));
      return name ? [{ name, ...(plate !== undefined ? { plate } : {}), ...(type !== undefined ? { type } : {}) }] : [];
    });
  }

  if (raw.factory !== undefined) {
    const section = at("factory").object(raw.factory, ["productionSteps", "clientPaymentReminderDays", "permits", "inspections"]);
    if (section) {
      const factory: NonNullable<Profile["factory"]> = {};
      if (section.productionSteps !== undefined) {
        const steps = at("factory.productionSteps").list(section.productionSteps, 4).flatMap((entry, index): ProductionStep[] => {
          const path = `factory.productionSteps[${index}]`;
          if (typeof entry === "string") {
            const kind = PRODUCTION_STEP_KINDS.find((candidate) => candidate === word(entry));
            if (!kind) { problems.push(`${path} is a step (${PRODUCTION_STEP_KINDS.join(", ")}) or {"kind", "label"}.`); return []; }
            return [{ kind, label: "" }];
          }
          const object = at(path).object(entry, ["kind", "label"]);
          if (!object) return [];
          const kind = at(`${path}.kind`).oneOf(object.kind, PRODUCTION_STEP_KINDS);
          const label = object.label === undefined ? "" : at(`${path}.label`).text(object.label, 40, true) ?? "";
          return kind ? [{ kind, label }] : [];
        });
        const order = steps.map((step) => PRODUCTION_STEP_KINDS.indexOf(step.kind));
        if (steps.length < 2 || steps.at(-1)?.kind !== "ready" || order.some((rank, index) => index > 0 && rank <= order[index - 1]))
          problems.push("factory.productionSteps: 2 to 4 steps in the order scheduled, in_production, quality_check, ready, each once, ending with ready.");
        factory.productionSteps = steps;
      }
      factory.clientPaymentReminderDays = optional(section, "clientPaymentReminderDays", (value) => at("factory.clientPaymentReminderDays").int(value, 0, 90));
      if (section.permits !== undefined) {
        const permits = at("factory.permits").object(section.permits, ["requiredForDeliveriesAndInstallations", "furnitureDeliveriesNeedOne", "missingAlertWorkingDays", "expiryReminderDays"]);
        if (permits) factory.permits = {
          requiredForDeliveriesAndInstallations: optional(permits, "requiredForDeliveriesAndInstallations", (value) => at("factory.permits.requiredForDeliveriesAndInstallations").bool(value)),
          furnitureDeliveriesNeedOne: optional(permits, "furnitureDeliveriesNeedOne", (value) => at("factory.permits.furnitureDeliveriesNeedOne").bool(value)),
          missingAlertWorkingDays: optional(permits, "missingAlertWorkingDays", (value) => at("factory.permits.missingAlertWorkingDays").int(value, 0, 30)),
          expiryReminderDays: optional(permits, "expiryReminderDays", (value) => at("factory.permits.expiryReminderDays").int(value, 0, 365)),
        };
      }
      if (section.inspections !== undefined) {
        const path = "factory.inspections";
        const inspections = at(path).object(section.inspections, ["enabled", "stages", "trades", "inspectorRole", "directorRole", "directorPackages", "workingDays"]);
        const role = (key: string, value: unknown) => {
          const text = at(`${path}.${key}`).text(value, 60);
          if (text !== undefined && !/^[a-z][a-z0-9_]{0,59}$/.test(text)) { problems.push(`${path}.${key} is a project role key (lower case letters, digits and _).`); return undefined; }
          return text;
        };
        if (inspections) {
          let stages: InspectionStage[] | undefined;
          if (inspections.stages !== undefined) {
            try { stages = parseInspectionStages(inspections.stages); } catch { problems.push(`${path}.stages: one or two of raw (before the final finish) and final (after finishing), each once, ending with final, names up to 60 characters.`); }
          }
          factory.inspections = {
            enabled: optional(inspections, "enabled", (value) => at(`${path}.enabled`).bool(value)),
            stages,
            trades: optional(inspections, "trades", (value) => at(`${path}.trades`).texts(value, 120)),
            inspectorRole: optional(inspections, "inspectorRole", (value) => role("inspectorRole", value)),
            directorRole: nullable(inspections, "directorRole", (value) => role("directorRole", value)),
            directorPackages: optional(inspections, "directorPackages", (value) => at(`${path}.directorPackages`).texts(value, 40)),
            workingDays: optional(inspections, "workingDays", (value) => at(`${path}.workingDays`).int(value, 1, 30)),
          };
        }
      }
      profile.factory = factory;
    }
  }

  if (raw.quotations !== undefined) {
    const section = at("quotations").object(raw.quotations, ["validityDays", "qsReview", "qsPrices", "qsItemTypes", "qsWorkPackages", "valueEngineeringFreeRounds"]);
    if (section) profile.quotations = {
      validityDays: optional(section, "validityDays", (value) => at("quotations.validityDays").int(value, 1, 365)),
      qsReview: optional(section, "qsReview", (value) => at("quotations.qsReview").bool(value)),
      qsPrices: optional(section, "qsPrices", (value) => at("quotations.qsPrices").oneOf(value, QS_SCOPES)),
      qsItemTypes: optional(section, "qsItemTypes", (value) => at("quotations.qsItemTypes").list(value, QS_ITEM_TYPES.length)
        .flatMap((entry, index) => { const type = at(`quotations.qsItemTypes[${index}]`).oneOf(entry, QS_ITEM_TYPES); return type ? [type] : []; })),
      qsWorkPackages: optional(section, "qsWorkPackages", (value) => at("quotations.qsWorkPackages").texts(value, 120)),
      // PLM-147: free value engineering rounds per job (null: no limit).
      valueEngineeringFreeRounds: nullable(section, "valueEngineeringFreeRounds", (value) => at("quotations.valueEngineeringFreeRounds").int(value, 0, 50) ?? null),
    };
  }

  if (raw.firstResponse !== undefined) {
    const section = at("firstResponse").object(raw.firstResponse, ["minutes", "warningMinutes", "workingCalendar"]);
    if (section) {
      const minutes = at("firstResponse.minutes").int(section.minutes, 1, 525_600) ?? 1;
      const warningMinutes = optional(section, "warningMinutes", (value) => at("firstResponse.warningMinutes").int(value, 0, 525_600));
      if (warningMinutes !== undefined && warningMinutes >= minutes) problems.push("firstResponse.warningMinutes is less than minutes.");
      let workingCalendar: NonNullable<Profile["firstResponse"]>["workingCalendar"];
      if (section.workingCalendar !== undefined) {
        const calendar = at("firstResponse.workingCalendar").object(section.workingCalendar, ["days", "start", "end", "timeZone"]);
        if (calendar) {
          const days = at("firstResponse.workingCalendar.days").texts(calendar.days, 7).map((day) => day.toLowerCase().slice(0, 3));
          if (!days.length || days.some((day) => !(WEEK_DAYS as readonly string[]).includes(day)) || new Set(days).size !== days.length)
            problems.push(`firstResponse.workingCalendar.days lists working days once each (${WEEK_DAYS.join(", ")}).`);
          const time = (key: "start" | "end") => {
            const value = calendar[key];
            if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) { problems.push(`firstResponse.workingCalendar.${key} is a time like 09:00.`); return "00:00"; }
            return value;
          };
          const start = time("start"), end = time("end");
          if (start >= end) problems.push("firstResponse.workingCalendar.end is after start.");
          const timeZone = optional(calendar, "timeZone", (value) => at("firstResponse.workingCalendar.timeZone").text(value, 64));
          if (timeZone) { try { new Intl.DateTimeFormat("en", { timeZone }); } catch { problems.push("firstResponse.workingCalendar.timeZone is not a known time zone."); } }
          workingCalendar = { days, start, end, ...(timeZone ? { timeZone } : {}) };
        }
      }
      profile.firstResponse = { minutes, ...(warningMinutes !== undefined ? { warningMinutes } : {}), ...(workingCalendar ? { workingCalendar } : {}) };
    }
  }

  if (raw.financeRequests !== undefined) {
    const section = at("financeRequests").object(raw.financeRequests, ["inbox", "autoStageInvoiceRequests", "paymentMethods"]);
    if (section) {
      const inbox = nullable(section, "inbox", (value) => {
        const text = at("financeRequests.inbox").text(value, 320);
        if (text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) problems.push("financeRequests.inbox is an email address.");
        return text?.toLowerCase();
      });
      const seen = new Set<string>();
      profile.financeRequests = {
        ...(inbox !== undefined ? { inbox: inbox ?? null } : {}),
        autoStageInvoiceRequests: optional(section, "autoStageInvoiceRequests", (value) => at("financeRequests.autoStageInvoiceRequests").bool(value)),
        paymentMethods: optional(section, "paymentMethods", (value) => at("financeRequests.paymentMethods").list(value, 50).flatMap((entry, index) => {
          const path = `financeRequests.paymentMethods[${index}]`;
          const object = at(path).object(entry, ["name", "refundDays", "guidance", "needsBankDetails"]);
          if (!object) return [];
          const name = at(`${path}.name`).text(object.name, 80);
          if (name && seen.has(name.toLowerCase())) problems.push(`${path}.name repeats "${name}".`);
          if (name) seen.add(name.toLowerCase());
          const method = {
            name: name ?? "",
            refundDays: nullable(object, "refundDays", (days) => at(`${path}.refundDays`).int(days, 1, 365) ?? null),
            guidance: optional(object, "guidance", (text) => at(`${path}.guidance`).text(text, 1000, true)),
            needsBankDetails: optional(object, "needsBankDetails", (flag) => at(`${path}.needsBankDetails`).bool(flag)),
          };
          return name ? [Object.fromEntries(Object.entries(method).filter(([, field]) => field !== undefined)) as typeof method] : [];
        })),
      };
    }
  }

  if (raw.approvals !== undefined) {
    const section = at("approvals").object(raw.approvals, ["payableRequest"]);
    if (section?.payableRequest !== undefined) {
      const payable = at("approvals.payableRequest").object(section.payableRequest, ["firstApproverRole", "secondApproverRole", "thresholdAmount"]);
      if (payable) {
        const firstApproverRole = at("approvals.payableRequest.firstApproverRole").text(payable.firstApproverRole, 100) ?? "";
        const secondApproverRole = nullable(payable, "secondApproverRole", (value) => at("approvals.payableRequest.secondApproverRole").text(value, 100) ?? null);
        const thresholdAmount = nullable(payable, "thresholdAmount", (value) => {
          const text = typeof value === "number" ? String(value) : value;
          if (typeof text !== "string" || !/^\d{1,16}(\.\d{1,4})?$/.test(text)) { problems.push("approvals.payableRequest.thresholdAmount is an amount like \"50000\"."); return null; }
          return text;
        });
        if (Boolean(secondApproverRole) !== Boolean(thresholdAmount)) problems.push("approvals.payableRequest: a second approver comes with its threshold amount (leave both out or null).");
        profile.approvals = { payableRequest: { firstApproverRole, secondApproverRole: secondApproverRole ?? null, thresholdAmount: thresholdAmount ?? null } };
      }
    } else if (section) profile.approvals = {};
  }

  if (raw.routes !== undefined) {
    profile.routes = at("routes").list(raw.routes, 20).flatMap((entry, index): RouteChange[] => {
      const path = `routes[${index}]`;
      const object = at(path).object(entry, ["route", "default", "addStages", "addChecks", "removeChecks"]);
      if (!object) return [];
      const isDefault = object.default === true;
      if (object.default !== undefined && typeof object.default !== "boolean") problems.push(`${path}.default is true or false.`);
      const route = object.route === undefined ? null : at(`${path}.route`).text(object.route, 120) ?? null;
      if (!route && !isDefault) problems.push(`${path} names its route ("route") or sets "default": true.`);
      const addStages = object.addStages === undefined ? [] : at(`${path}.addStages`).list(object.addStages, 20).flatMap((stage, stageIndex) => {
        const stagePath = `${path}.addStages[${stageIndex}]`;
        const fields = at(stagePath).object(stage, ["name", "key", "ownerRole", "before", "after", "checks"]);
        if (!fields) return [];
        const name = at(`${stagePath}.name`).text(fields.name, 120);
        const key = optional(fields, "key", (value) => {
          if (typeof value !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) { problems.push(`${stagePath}.key is lowercase letters, digits and _.`); return undefined; }
          return value;
        });
        const ownerRole = nullable(fields, "ownerRole", (value) => at(`${stagePath}.ownerRole`).text(value, 64) ?? null);
        const before = optional(fields, "before", (value) => at(`${stagePath}.before`).text(value, 120));
        const after = optional(fields, "after", (value) => at(`${stagePath}.after`).text(value, 120));
        if (Boolean(before) === Boolean(after)) problems.push(`${stagePath} goes "before" or "after" a named stage (one of them).`);
        const checks = fields.checks === undefined ? [] : at(`${stagePath}.checks`).list(fields.checks, 12).flatMap((check, checkIndex) => checkSpec(`${stagePath}.checks[${checkIndex}]`, check) ?? []);
        return name ? [{ name, ...(key ? { key } : {}), ...(ownerRole !== undefined ? { ownerRole } : {}), ...(before ? { before } : {}), ...(after ? { after } : {}), checks }] : [];
      });
      const stageChecks = (key: "addChecks" | "removeChecks") => object[key] === undefined ? [] : at(`${path}.${key}`).list(object[key], 20).flatMap((stage, stageIndex) => {
        const stagePath = `${path}.${key}[${stageIndex}]`;
        const fields = at(stagePath).object(stage, ["stage", "checks"]);
        if (!fields) return [];
        const name = at(`${stagePath}.stage`).text(fields.stage, 120);
        const checks = at(`${stagePath}.checks`).list(fields.checks, 12).flatMap((check, checkIndex) => checkSpec(`${stagePath}.checks[${checkIndex}]`, check) ?? []);
        return name ? [{ stage: name, checks }] : [];
      });
      const addChecks = stageChecks("addChecks");
      const removeChecks = stageChecks("removeChecks");
      return [{ route, isDefault, addStages, addChecks, ...(removeChecks.length ? { removeChecks } : {}) }];
    });
  }

  if (raw.rolePermissions !== undefined) {
    profile.rolePermissions = at("rolePermissions").list(raw.rolePermissions, 50).flatMap((entry, index) => {
      const path = `rolePermissions[${index}]`;
      const object = at(path).object(entry, ["roles", "permissions"]);
      if (!object) return [];
      const roles = at(`${path}.roles`).texts(object.roles, 64);
      const permissions = at(`${path}.permissions`).texts(object.permissions, 100);
      if (permissions.some((code) => !/^[a-z][a-z0-9_.]{1,99}$/.test(code))) problems.push(`${path}.permissions are permission codes like reports.management.view.`);
      if (!roles.length || !permissions.length) problems.push(`${path} names at least one role and one permission.`);
      return [{ roles, permissions }];
    });
  }

  if (raw.design !== undefined) {
    const section = at("design").object(raw.design, ["renderInternalDays", "renderClientDays", "revisionsIncluded", "packages", "steps", "team", "projectRoles"]);
    if (section) {
      const roleKey = /^[a-z][a-z0-9_]{0,63}$/;
      const design: NonNullable<Profile["design"]> = {
        renderInternalDays: nullable(section, "renderInternalDays", (value) => at("design.renderInternalDays").int(value, 1, 365) ?? null),
        renderClientDays: nullable(section, "renderClientDays", (value) => at("design.renderClientDays").int(value, 1, 365) ?? null),
        revisionsIncluded: optional(section, "revisionsIncluded", (value) => at("design.revisionsIncluded").int(value, 0, 20)),
        packages: optional(section, "packages", (value) => at("design.packages").texts(value, 40)),
        steps: optional(section, "steps", (value) => {
          const steps = at("design.steps").object(value, [...DESIGN_STEP_KEYS, "conceptOptionsMax"]);
          if (!steps) return undefined;
          const read: NonNullable<NonNullable<Profile["design"]>["steps"]> = {};
          for (const key of DESIGN_STEP_KEYS) {
            const days = optional(steps, key, (entry) => at(`design.steps.${key}`).int(entry, key === "developmentDaysPerRoom" ? 0 : 1, 365));
            if (days !== undefined) read[key] = days;
          }
          const options = nullable(steps, "conceptOptionsMax", (entry) => at("design.steps.conceptOptionsMax").int(entry, 1, 12) ?? null);
          if (options !== undefined) read.conceptOptionsMax = options;
          if (read.developmentMinDays && read.developmentMaxDays && read.developmentMaxDays < read.developmentMinDays) problems.push("design.steps.developmentMaxDays is at least developmentMinDays.");
          return read;
        }),
        team: optional(section, "team", (value) => {
          const team = at("design.team").object(value, [...DESIGN_TEAM_KEYS]);
          if (!team) return undefined;
          const read: Partial<Record<DesignTeamKey, string | null>> = {};
          for (const key of DESIGN_TEAM_KEYS) {
            const role = nullable(team, key, (entry) => at(`design.team.${key}`).text(entry, 64));
            if (role === undefined) continue;
            if (role === null && key === "lead_designer") { problems.push("design.team.lead_designer names a role."); continue; }
            if (role && !roleKey.test(role)) { problems.push(`design.team.${key} is a role key like junior_designer.`); continue; }
            read[key] = role;
          }
          return read;
        }),
        projectRoles: optional(section, "projectRoles", (value) => at("design.projectRoles").list(value, 40).flatMap((entry, index) => {
          const object = at(`design.projectRoles[${index}]`).object(entry, ["key", "label"]);
          if (!object) return [];
          const key = at(`design.projectRoles[${index}].key`).text(object.key, 64);
          const label = at(`design.projectRoles[${index}].label`).text(object.label, 80);
          if (key && !roleKey.test(key)) problems.push(`design.projectRoles[${index}].key is a role key like junior_designer.`);
          return key && label ? [{ key, label }] : [];
        })),
      };
      if (design.renderInternalDays && design.renderClientDays && design.renderClientDays < design.renderInternalDays)
        problems.push("design.renderClientDays is at least design.renderInternalDays.");
      profile.design = Object.fromEntries(Object.entries(design).filter(([, value]) => value !== undefined));
    }
  }

  if (raw.orderPaths !== undefined) {
    const seen = new Set<string>();
    profile.orderPaths = at("orderPaths").list(raw.orderPaths, 100).flatMap((entry, index): OrderPathChange[] => {
      const path = `orderPaths[${index}]`;
      const object = at(path).object(entry, ["enquiryType", "path", "boqRequired", "reserveOn", "deductOn", "takeFrom", "leadDays", "leadFrom"]);
      if (!object) return [];
      const enquiryType = at(`${path}.enquiryType`).text(object.enquiryType, 160) ?? "";
      const furniturePath = object.path === null || object.path === undefined ? null : at(`${path}.path`).oneOf(object.path, FURNITURE_PATHS) ?? null;
      const id = `${enquiryType.toLowerCase()}|${furniturePath ?? ""}`;
      if (seen.has(id)) problems.push(`${path} repeats ${enquiryType} ${furniturePath ?? "(whole type)"}.`);
      seen.add(id);
      const change: OrderPathChange = { enquiryType, path: furniturePath };
      if (object.boqRequired !== undefined) {
        if (object.boqRequired !== null && typeof object.boqRequired !== "boolean") problems.push(`${path}.boqRequired is true, false or null.`);
        change.boqRequired = object.boqRequired as boolean | null;
      }
      if (object.reserveOn !== undefined) change.reserveOn = at(`${path}.reserveOn`).oneOf(object.reserveOn, RESERVE_EVENTS);
      if (object.deductOn !== undefined) change.deductOn = at(`${path}.deductOn`).oneOf(object.deductOn, DEDUCT_EVENTS);
      if (object.leadFrom !== undefined) change.leadFrom = at(`${path}.leadFrom`).oneOf(object.leadFrom, LEAD_FROM);
      if (object.takeFrom !== undefined) change.takeFrom = object.takeFrom === null ? null : at(`${path}.takeFrom`).text(object.takeFrom, 160) ?? null;
      if (object.leadDays !== undefined) {
        if (object.leadDays === null) change.leadDays = null;
        else {
          const days = at(`${path}.leadDays`).object(object.leadDays, ["min", "max"]);
          const min = days ? at(`${path}.leadDays.min`).int(days.min, 0, 365) : undefined;
          const max = days ? at(`${path}.leadDays.max`).int(days.max, 0, 365) : undefined;
          if (min !== undefined && max !== undefined) {
            if (min > max) problems.push(`${path}.leadDays.min is at most max.`);
            change.leadDays = { min, max };
          }
        }
      }
      return [change];
    });
  }

  if (raw.projects !== undefined) {
    const section = at("projects").object(raw.projects, ["drawingsClientRole", "technicalMeasureDays"]);
    if (section) {
      const projects: NonNullable<Profile["projects"]> = {
        drawingsClientRole: nullable(section, "drawingsClientRole", (value) => {
          if (typeof value !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) { problems.push("projects.drawingsClientRole is a project role key like designer, or null."); return null; }
          return value;
        }),
        technicalMeasureDays: nullable(section, "technicalMeasureDays", (value) => at("projects.technicalMeasureDays").int(value, 1, 60) ?? null),
      };
      profile.projects = Object.fromEntries(Object.entries(projects).filter(([, value]) => value !== undefined));
    }
  }

  if (raw.finishes !== undefined) {
    const section = at("finishes").object(raw.finishes, ["categories", "specificationGate", "finishesToQsDays", "materialEditors", "priceBands"]);
    if (section) {
      const finishes: NonNullable<Profile["finishes"]> = {
        categories: optional(section, "categories", (value) => {
          const seen = new Set<string>();
          return at("finishes.categories").list(value, 40).flatMap((entry, index) => {
            const path = `finishes.categories[${index}]`;
            const object = at(path).object(entry, ["key", "label", "clientSignature"]);
            if (!object) return [];
            const key = at(`${path}.key`).text(object.key, 40);
            const label = at(`${path}.label`).text(object.label, 80);
            const clientSignature = object.clientSignature === undefined ? false : at(`${path}.clientSignature`).bool(object.clientSignature) ?? false;
            if (key && !/^[a-z][a-z0-9_]{0,39}$/.test(key)) { problems.push(`${path}.key is a key like sanitary_ware.`); return []; }
            if (key && seen.has(key)) { problems.push(`${path}.key ${key} is in the list twice.`); return []; }
            if (key) seen.add(key);
            return key && label ? [{ key, label, clientSignature }] : [];
          });
        }),
        specificationGate: optional(section, "specificationGate", (value) => at("finishes.specificationGate").bool(value)),
        finishesToQsDays: optional(section, "finishesToQsDays", (value) => at("finishes.finishesToQsDays").int(value, 1, 60)),
        materialEditors: optional(section, "materialEditors", (value) => at("finishes.materialEditors").texts(value, 40).filter((slot) => {
          if ((DESIGN_TEAM_KEYS as readonly string[]).includes(slot) && slot !== "technicalLeadRoleCode") return true;
          problems.push(`finishes.materialEditors names parts of the design team (${DESIGN_TEAM_KEYS.filter((key) => key !== "technicalLeadRoleCode").join(", ")}).`);
          return false;
        })),
        priceBands: optional(section, "priceBands", (value) => at("finishes.priceBands").list(value, 20).flatMap((entry, index) => {
          const path = `finishes.priceBands[${index}]`;
          const object = at(path).object(entry, ["label", "minAmount", "maxAmount"]);
          if (!object) return [];
          const label = at(`${path}.label`).text(object.label, 80);
          const amount = (key: "minAmount" | "maxAmount") => {
            const raw_ = object[key];
            if (raw_ === undefined || raw_ === null) return null;
            if (typeof raw_ !== "string" || !/^\d{1,12}(\.\d{1,2})?$/.test(raw_)) { problems.push(`${path}.${key} is an amount as text, like "250" or "99.50".`); return null; }
            return raw_;
          };
          const minAmount = amount("minAmount"), maxAmount = amount("maxAmount");
          if (minAmount && maxAmount && Number(maxAmount) < Number(minAmount)) problems.push(`${path}.maxAmount is at least minAmount.`);
          return label ? [{ label, minAmount, maxAmount }] : [];
        })),
      };
      profile.finishes = Object.fromEntries(Object.entries(finishes).filter(([, value]) => value !== undefined));
    }
  }

  if (raw.clientUpdates !== undefined) {
    const section = at("clientUpdates").object(raw.clientUpdates, ["mode", "frequency"]);
    if (section) {
      const mode = at("clientUpdates.mode").oneOf(section.mode, ["call", "portal"] as const);
      const frequency = at("clientUpdates.frequency").oneOf(section.frequency, ["weekly", "fortnightly", "monthly", "off"] as const);
      if (mode && frequency) profile.clientUpdates = { mode, frequency };
    }
  }

  if (raw.catalogCategories !== undefined) {
    profile.catalogCategories = at("catalogCategories").list(raw.catalogCategories, 20).flatMap((entry, index): CategoryCleanup[] => {
      const path = `catalogCategories[${index}]`;
      const object = at(path).object(entry, ["catalog", "merge", "deleteEmpty", "deleteEmptyDuplicates", "rename", "parent"]);
      if (!object) return [];
      const catalog = at(`${path}.catalog`).text(object.catalog, 160) ?? "";
      const pairs = <K extends string>(key: string, keys: [K, K]) => object[key] === undefined ? [] : at(`${path}.${key}`).list(object[key]).flatMap((pair, pairIndex) => {
        const pairPath = `${path}.${key}[${pairIndex}]`;
        const fields = at(pairPath).object(pair, keys);
        if (!fields) return [];
        const [first, second] = keys.map((name) => at(`${pairPath}.${name}`).text(fields[name], 160));
        return first && second ? [{ [keys[0]]: first, [keys[1]]: second } as Record<K, string>] : [];
      });
      const merge = pairs("merge", ["from", "into"]);
      const rename = pairs("rename", ["from", "to"]);
      const parent = object.parent === undefined ? [] : at(`${path}.parent`).list(object.parent).flatMap((pair, pairIndex) => {
        const pairPath = `${path}.parent[${pairIndex}]`;
        const fields = at(pairPath).object(pair, ["category", "parent"]);
        if (!fields) return [];
        const category = at(`${pairPath}.category`).text(fields.category, 160);
        const above = fields.parent === null ? null : at(`${pairPath}.parent`).text(fields.parent, 160);
        if (above !== undefined && above !== null && category && above.toLowerCase() === category.toLowerCase()) problems.push(`${pairPath}: a category can't sit under itself.`);
        return category && above !== undefined ? [{ category, parent: above }] : [];
      });
      for (const pair of merge) if (pair.from.toLowerCase() === pair.into.toLowerCase()) problems.push(`${path}.merge: ${pair.from} merges into another category.`);
      const deleteEmpty = object.deleteEmpty === undefined ? [] : at(`${path}.deleteEmpty`).texts(object.deleteEmpty, 160);
      const deleteEmptyDuplicates = object.deleteEmptyDuplicates === undefined ? false : at(`${path}.deleteEmptyDuplicates`).bool(object.deleteEmptyDuplicates) ?? false;
      if (!merge.length && !rename.length && !parent.length && !deleteEmpty.length && !deleteEmptyDuplicates) problems.push(`${path} has nothing to do (merge, deleteEmpty, deleteEmptyDuplicates, rename or parent).`);
      return catalog ? [{ catalog, merge, deleteEmpty, deleteEmptyDuplicates, rename, parent }] : [];
    });
  }

  if (problems.length) throw new ProfileError(problems);
  return profile;
}
