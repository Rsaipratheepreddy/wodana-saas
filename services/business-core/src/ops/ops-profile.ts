import { FURNITURE_PATHS } from "../crm/opportunities/flow-gates";
import { QUEUE_ASSIGNMENT_MODES, type QueueAssignmentMode } from "../crm/leads/round-robin";
import { checkDesignPackage } from "../design/design-packages.domain";
import {
  MAX_CHECKLIST_SCOPES, MAX_SITE_QUESTIONS, normaliseChecklistScopes, normaliseSiteQuestions, scopeKey, type ChecklistScope, type SiteQuestion,
} from "../design/design-journey.domain";
import { parseInspectionStages, type InspectionStage } from "../factory/factory-inspections";
import { PRODUCTION_STEP_KINDS, type ProductionStep } from "../factory/production-status";
import { DEDUCT_EVENTS, LEAD_FROM, RESERVE_EVENTS } from "../fulfilment/fulfilment-rules";
import { CHECK_KINDS } from "../project-core/project-checks";
import { SECTIONS as PORTAL_SECTIONS, type Section as PortalSection } from "../client-portal/portal-settings";
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
  /**
   * The client portal (PLM-170): which sections clients see (a section left out keeps its switch), and the enquiry type codes
   * and order paths whose projects show the bill of quantities (empty: every project the section is on for).
   */
  clientPortal?: { sections?: Partial<Record<PortalSection, boolean>>; boqEnquiryTypes?: string[] };
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
  /**
   * The inbox (PLM-137): the three closing messages' texts ({{name}}, {{form_link}}; null keeps the product's wording),
   * the enquiry form link {{form_link}} fills (null: the firm's first published form), and the working hours without a
   * reply before "Closing the chat" is offered.
   */
  inbox?: { closingMessages?: { received?: string | null; form?: string | null; closing?: string | null }; closingFormUrl?: string | null; closingAfterHours?: number };
  /**
   * Sales: the teams (by code) whose people answer timeline questions on an opportunity (PLM-155), how every active
   * Sales queue shares new enquiries and chats (balanced: the lightest load first; round_robin: strict turns), and
   * whether an enquiry nobody picks up goes back to Unassigned after a working day, with the Owners told (PLM-180).
   */
  sales?: { timelineCheckTeams?: string[]; assignmentMode?: QueueAssignmentMode; unassignAfterWorkingDay?: boolean };
  /**
   * Enquiry fields required from a gate (PLM-096, PLM-155), for every enquiry type unless some are named. A field already
   * required from an earlier gate stays so (the profile never loosens a rule).
   */
  enquiryRequirements?: Array<{ field: string; requiredAt: "create" | "convert" | "book_intro"; enquiryTypes?: string[] }>;
};

export const DESIGN_STEP_KEYS = ["allocationDays", "kickoffDays", "conceptDays", "siteMeasureDays", "developmentMinDays", "developmentMaxDays", "developmentDaysPerRoom",
  "sampleCollectionDays", "sampleMeetingDays"] as const;
export type DesignStepKey = (typeof DESIGN_STEP_KEYS)[number];
export const DESIGN_TEAM_KEYS = ["lead_designer", "junior_designer", "sales_admin", "visualiser", "draftsman", "material_coordinator", "technicalLeadRoleCode"] as const;
export type DesignTeamKey = (typeof DESIGN_TEAM_KEYS)[number];

export const PROFILE_SECTIONS = ["enquiryTypes", "vehicles", "factory", "quotations", "firstResponse", "financeRequests", "approvals", "routes", "rolePermissions",
  "design", "orderPaths", "clientUpdates", "clientPortal", "catalogCategories", "projects", "finishes", "inbox", "sales", "enquiryRequirements"] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];
export const WEEK_DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export class ProfileError extends Error {
  constructor(readonly problems: string[], what = "profile") { super(`The ${what} is not valid:\n  - ${problems.join("\n  - ")}`); }
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

  if (raw.inbox !== undefined) {
    const section = at("inbox").object(raw.inbox, ["closingMessages", "closingFormUrl", "closingAfterHours"]);
    if (section) {
      const texts = section.closingMessages === undefined ? undefined : at("inbox.closingMessages").object(section.closingMessages, ["received", "form", "closing"]);
      const closingMessages = texts ? Object.fromEntries((["received", "form", "closing"] as const).flatMap((kind) => {
        const value = nullable(texts, kind, (entry) => {
          const text = at(`inbox.closingMessages.${kind}`).text(entry, 1024);
          if (text && /\{\{\s*(?!name\b|form_link\b)[a-z_]+\s*\}\}/.test(text)) problems.push(`inbox.closingMessages.${kind} can fill {{name}} and {{form_link}} only.`);
          return text ?? null;
        });
        return value === undefined ? [] : [[kind, value]];
      })) : undefined;
      const inbox: NonNullable<Profile["inbox"]> = {
        closingMessages,
        closingFormUrl: nullable(section, "closingFormUrl", (value) => {
          if (typeof value !== "string" || !/^https:\/\/\S{3,}$/.test(value.trim())) { problems.push("inbox.closingFormUrl is a full https:// link, or null."); return null; }
          return value.trim();
        }),
        closingAfterHours: optional(section, "closingAfterHours", (value) => at("inbox.closingAfterHours").int(value, 1, 72)),
      };
      profile.inbox = Object.fromEntries(Object.entries(inbox).filter(([, value]) => value !== undefined));
    }
  }

  if (raw.sales !== undefined) {
    const section = at("sales").object(raw.sales, ["timelineCheckTeams", "assignmentMode", "unassignAfterWorkingDay"]);
    if (section) {
      const teams = optional(section, "timelineCheckTeams", (value) => at("sales.timelineCheckTeams").texts(value, 64));
      if (teams?.some((code) => !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(code))) problems.push("sales.timelineCheckTeams are team codes like INTERIOR_DESIGN.");
      const assignmentMode = optional(section, "assignmentMode", (value) => at("sales.assignmentMode").oneOf(value, QUEUE_ASSIGNMENT_MODES));
      const unassignAfterWorkingDay = optional(section, "unassignAfterWorkingDay", (value) => at("sales.unassignAfterWorkingDay").bool(value));
      profile.sales = {
        ...(teams === undefined ? {} : { timelineCheckTeams: teams }),
        ...(assignmentMode === undefined ? {} : { assignmentMode }),
        ...(unassignAfterWorkingDay === undefined ? {} : { unassignAfterWorkingDay }),
      };
    }
  }

  if (raw.enquiryRequirements !== undefined) {
    profile.enquiryRequirements = at("enquiryRequirements").list(raw.enquiryRequirements, 50).flatMap((entry, index) => {
      const path = `enquiryRequirements[${index}]`;
      const object = at(path).object(entry, ["field", "requiredAt", "enquiryTypes"]);
      if (!object) return [];
      const field = at(`${path}.field`).text(object.field, 80);
      const requiredAt = at(`${path}.requiredAt`).oneOf(object.requiredAt, ["create", "convert", "book_intro"] as const);
      const enquiryTypes = optional(object, "enquiryTypes", (value) => at(`${path}.enquiryTypes`).texts(value, 100));
      return field && requiredAt ? [{ field, requiredAt, ...(enquiryTypes ? { enquiryTypes } : {}) }] : [];
    });
  }

  if (raw.clientUpdates !== undefined) {
    const section = at("clientUpdates").object(raw.clientUpdates, ["mode", "frequency"]);
    if (section) {
      const mode = at("clientUpdates.mode").oneOf(section.mode, ["call", "portal"] as const);
      const frequency = at("clientUpdates.frequency").oneOf(section.frequency, ["weekly", "fortnightly", "monthly", "off"] as const);
      if (mode && frequency) profile.clientUpdates = { mode, frequency };
    }
  }

  if (raw.clientPortal !== undefined) {
    const section = at("clientPortal").object(raw.clientPortal, ["sections", "boqEnquiryTypes"]);
    if (section) {
      const portal: NonNullable<Profile["clientPortal"]> = {};
      if (section.sections !== undefined) {
        const sections = at("clientPortal.sections").object(section.sections, [...PORTAL_SECTIONS]);
        if (sections) portal.sections = Object.fromEntries(Object.entries(sections).filter(([key]) => !key.startsWith("_") && (PORTAL_SECTIONS as readonly string[]).includes(key))
          .flatMap(([key, value]) => { const on = at(`clientPortal.sections.${key}`).bool(value); return on === undefined ? [] : [[key, on]]; }));
      }
      if (section.boqEnquiryTypes !== undefined) portal.boqEnquiryTypes = at("clientPortal.boqEnquiryTypes").texts(section.boqEnquiryTypes, 80).map(word);
      profile.clientPortal = portal;
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

// ---------- design packages file (configure --packages) ----------

/**
 * One design package as the file lists it (e.g. docs/fixtures/palm-design-packages.json), matched by code: the whole
 * package, as Settings › Design saves it. Its code, name, pricing and rate are always given; another field left out
 * takes the product's default (e.g. no required role, 2 revisions), and a currency left out is the workspace's.
 */
export type PackageSpec = {
  code: string; name: string; pricingMethod: "per_space" | "per_area" | "fixed"; rate: string; currency?: string; areaUnit?: "sqft" | "sqm" | null;
  includedRevisions?: number; includesSpacePlanning?: boolean; includesRenders?: boolean; requiredRoleCode?: string | null; inclusions?: string | null; position?: number;
  reviewRoleCode?: string | null; rateFrom?: boolean; unitDefinition?: string | null;
};
/**
 * The design packages file: the packages and, when given, the minimum design deposit (null: no minimum), the question
 * list asked at the kick-off and the site measure (general questions under sections, checklist lines under a scope),
 * and each checklist's match words. The list is set whole when given, as Settings › Design saves it.
 */
export type PackagesFile = {
  minimumDeposit?: { amount: string; currency?: string } | null; packages: PackageSpec[];
  siteVisitQuestions?: SiteQuestion[]; siteVisitScopes?: ChecklistScope[];
};

const PACKAGE_KEYS = ["code", "name", "pricingMethod", "rate", "currency", "areaUnit", "includedRevisions", "includesSpacePlanning", "includesRenders", "requiredRoleCode",
  "inclusions", "position", "reviewRoleCode", "rateFrom", "unitDefinition"] as const;
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
const CURRENCY = /^[A-Z]{3}$/;
const ROLE_CODE = /^[a-z][a-z0-9_]{1,59}$/;

/** Validates a parsed design packages file; every problem is listed at once (the package rules are the app's own). */
export function validatePackagesFile(raw: unknown): PackagesFile {
  const problems: string[] = [];
  const fail = (): never => { throw new ProfileError(problems, "design packages file"); };
  if (!isObject(raw)) { problems.push("It is a JSON object with a list of packages (\"packages\")."); fail(); }
  const file = raw as Obj;
  const extra = Object.keys(file).filter((key) => !["packages", "minimumDeposit", "siteVisitQuestions", "siteVisitScopes", "source", "description", "$schema"].includes(key)
    && !key.startsWith("_"));
  if (extra.length) problems.push(`Unknown keys: ${extra.join(", ")}.`);
  const result: PackagesFile = { packages: [] };

  if (file.minimumDeposit !== undefined) {
    const deposit = file.minimumDeposit;
    if (deposit === null) result.minimumDeposit = null;
    else if (!isObject(deposit) || Object.keys(deposit).some((key) => key !== "amount" && key !== "currency")) problems.push("minimumDeposit is null or { amount, currency }.");
    else if (typeof deposit.amount !== "string" || !AMOUNT.test(deposit.amount)) problems.push("minimumDeposit.amount is an amount as text, e.g. \"15000.00\".");
    else if (deposit.currency !== undefined && (typeof deposit.currency !== "string" || !CURRENCY.test(deposit.currency))) problems.push("minimumDeposit.currency is a currency code, e.g. EUR.");
    else result.minimumDeposit = { amount: deposit.amount, ...(deposit.currency ? { currency: deposit.currency as string } : {}) };
  }

  if (!Array.isArray(file.packages) || !file.packages.length || file.packages.length > 50) problems.push("packages is a list of 1 to 50 packages.");
  const seen = new Set<string>();
  (Array.isArray(file.packages) ? file.packages : []).forEach((entry: unknown, index) => {
    const path = `packages[${index}]`;
    if (!isObject(entry)) { problems.push(`${path} is an object.`); return; }
    const before = problems.length;
    const unknown = Object.keys(entry).filter((key) => !(PACKAGE_KEYS as readonly string[]).includes(key) && !key.startsWith("_"));
    if (unknown.length) problems.push(`${path} has unknown keys: ${unknown.join(", ")}.`);
    for (const key of ["code", "name", "pricingMethod", "rate"]) if (entry[key] === undefined) problems.push(`${path}.${key} is required.`);
    const text = (key: string, test: (value: string) => boolean, what: string, nullable = false) => {
      const value = entry[key];
      if (value === undefined || (nullable && value === null)) return;
      if (typeof value !== "string" || !test(value)) problems.push(`${path}.${key} is ${what}${nullable ? " (or null)" : ""}.`);
    };
    text("code", (value) => /^[a-z][a-z0-9_]{1,39}$/.test(value.trim().toLowerCase()), "a code of letters, digits and _ (2 to 40)");
    text("name", (value) => Boolean(value.trim()) && value.trim().length <= 120, "the package's name (at most 120 characters)");
    text("pricingMethod", (value) => ["per_space", "per_area", "fixed"].includes(value), "per_space, per_area or fixed");
    text("rate", (value) => AMOUNT.test(value), "an amount as text, e.g. \"40.00\" (never a number)");
    text("currency", (value) => CURRENCY.test(value), "a currency code, e.g. EUR");
    text("areaUnit", (value) => value === "sqft" || value === "sqm", "sqft or sqm", true);
    text("requiredRoleCode", (value) => ROLE_CODE.test(value.trim()), "a role code like designer", true);
    text("reviewRoleCode", (value) => ROLE_CODE.test(value.trim().toLowerCase()), "a role code like creative_director", true);
    text("inclusions", (value) => value.trim().length <= 2000, "text of at most 2000 characters", true);
    text("unitDefinition", (value) => value.trim().length <= 200, "text of at most 200 characters", true);
    for (const key of ["includesSpacePlanning", "includesRenders", "rateFrom"]) if (entry[key] !== undefined && typeof entry[key] !== "boolean") problems.push(`${path}.${key} is true or false.`);
    const int = (key: string, min: number, max: number) => {
      if (entry[key] !== undefined && (!Number.isInteger(entry[key]) || (entry[key] as number) < min || (entry[key] as number) > max)) problems.push(`${path}.${key} is a whole number from ${min} to ${max}.`);
    };
    int("includedRevisions", 0, 20);
    int("position", 0, 1000);
    if (problems.length > before) return;
    const spec = entry as unknown as PackageSpec;
    const code = spec.code.trim().toLowerCase();
    if (seen.has(code)) { problems.push(`${path}.code repeats ${code}.`); return; }
    seen.add(code);
    // The app's own rules for a package (e.g. a price per area names its unit), with the workspace's currency standing in.
    try { checkDesignPackage({ ...spec, currency: spec.currency ?? "XXX" }); } catch (error) { problems.push(`${path} (${code}): ${(error as Error).message}.`); return; }
    result.packages.push({ ...spec, code });
  });
  const questions = file.siteVisitQuestions === undefined ? undefined : siteQuestionsIn(file.siteVisitQuestions, problems);
  if (questions) result.siteVisitQuestions = questions;
  if (file.siteVisitScopes !== undefined) {
    if (!questions) problems.push("siteVisitScopes goes with the siteVisitQuestions it describes.");
    else result.siteVisitScopes = checklistScopesIn(file.siteVisitScopes, questions, problems);
  }
  if (problems.length) fail();
  return result;
}

const QUESTION_KEYS = ["key", "question", "scope", "section", "kind"];
const QUESTION_KEY = /^[a-z0-9_.-]{1,60}$/;

/** The question list as the file gives it: unique keys, text, and an optional scope, section and kind ("answer" or "check"). */
function siteQuestionsIn(raw: unknown, problems: string[]): SiteQuestion[] | undefined {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_SITE_QUESTIONS) { problems.push(`siteVisitQuestions is a list of 1 to ${MAX_SITE_QUESTIONS} questions.`); return undefined; }
  const seen = new Set<string>();
  const out: SiteQuestion[] = [];
  raw.forEach((entry: unknown, index) => {
    const path = `siteVisitQuestions[${index}]`;
    if (!isObject(entry)) { problems.push(`${path} is an object.`); return; }
    const before = problems.length;
    const unknown = Object.keys(entry).filter((key) => !QUESTION_KEYS.includes(key) && !key.startsWith("_"));
    if (unknown.length) problems.push(`${path} has unknown keys: ${unknown.join(", ")}.`);
    if (typeof entry.key !== "string" || !QUESTION_KEY.test(entry.key)) problems.push(`${path}.key is a key of lowercase letters, digits, ".", "_" or "-" (at most 60), e.g. kitchen.01.`);
    else if (seen.has(entry.key)) problems.push(`${path}.key repeats ${entry.key}.`);
    if (typeof entry.question !== "string" || !entry.question.trim() || entry.question.trim().length > 500) problems.push(`${path}.question is the question's text (at most 500 characters).`);
    for (const key of ["scope", "section"]) {
      const value = entry[key];
      if (value !== undefined && value !== null && (typeof value !== "string" || !value.trim() || value.trim().length > 60)) problems.push(`${path}.${key} is a name of at most 60 characters (or null).`);
    }
    if (entry.kind !== undefined && entry.kind !== null && entry.kind !== "answer" && entry.kind !== "check") problems.push(`${path}.kind is answer or check.`);
    if (problems.length > before) return;
    seen.add(entry.key as string);
    out.push(...normaliseSiteQuestions([entry]));
  });
  return out;
}

/** Each checklist's match words, for scopes the questions use: once each, at most 20 words or phrases of 40 characters. */
function checklistScopesIn(raw: unknown, questions: SiteQuestion[], problems: string[]): ChecklistScope[] {
  if (!Array.isArray(raw) || raw.length > MAX_CHECKLIST_SCOPES) { problems.push(`siteVisitScopes is a list of at most ${MAX_CHECKLIST_SCOPES} checklists.`); return []; }
  const used = new Set(questions.filter((question) => question.scope).map((question) => scopeKey(question.scope!)));
  const seen = new Set<string>();
  const out: ChecklistScope[] = [];
  raw.forEach((entry: unknown, index) => {
    const path = `siteVisitScopes[${index}]`;
    if (!isObject(entry)) { problems.push(`${path} is an object.`); return; }
    const before = problems.length;
    const unknown = Object.keys(entry).filter((key) => !["scope", "match", "everyJob"].includes(key) && !key.startsWith("_"));
    if (unknown.length) problems.push(`${path} has unknown keys: ${unknown.join(", ")}.`);
    const scope = typeof entry.scope === "string" ? entry.scope.trim() : "";
    if (!scope || scope.length > 60) problems.push(`${path}.scope is the checklist's name (at most 60 characters).`);
    else if (seen.has(scopeKey(scope))) problems.push(`${path}.scope repeats ${scope}.`);
    else if (!used.has(scopeKey(scope))) problems.push(`${path}.scope ${scope} is not the scope of any question.`);
    const match = entry.match === undefined ? [] : entry.match;
    if (!Array.isArray(match) || match.length > 20 || match.some((word) => typeof word !== "string" || !word.trim() || word.trim().length > 40))
      problems.push(`${path}.match is a list of at most 20 words or phrases (40 characters each).`);
    if (entry.everyJob !== undefined && typeof entry.everyJob !== "boolean") problems.push(`${path}.everyJob is true or false.`);
    if (problems.length > before) return;
    seen.add(scopeKey(scope));
    out.push(...normaliseChecklistScopes([{ scope, match, everyJob: entry.everyJob === true }]));
  });
  return out;
}

/**
 * Where a profile's design section would undo the packages file on every run (it sets the included revisions of the
 * packages it covers): the file's packages and the profile must agree, or a second run would change them back.
 */
export function packagesAgainstProfile(file: PackagesFile, profile: Profile | null): string[] {
  const revisions = profile?.design?.revisionsIncluded;
  if (revisions === undefined) return [];
  const covered = profile!.design!.packages?.map((code) => code.toLowerCase());
  return file.packages.flatMap((entry) => {
    // A package left without its revisions has the product's default.
    const included = checkDesignPackage({ ...entry, currency: entry.currency ?? "XXX" }).includedRevisions;
    return included !== revisions && (!covered || covered.includes(entry.code))
      ? [`design package ${entry.code} includes ${included} revisions in the packages file but the profile's design.revisionsIncluded is ${revisions}; make them the same.`] : [];
  });
}
