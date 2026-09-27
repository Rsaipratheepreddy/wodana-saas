import { BadRequestException } from "@nestjs/common";

/** The role that leads a project. Its label is the firm's; the key is fixed. */
export const LEAD_ROLE = "project_manager";

export type ProjectRole = { key: string; label: string };

/**
 * What must be true to finish a stage. Checks read from data wherever the data exists; `confirm` is a
 * person confirming something the system doesn't record yet (e.g. "Kickoff meeting held").
 */
export const CHECK_KINDS = ["confirm", "lead_assigned", "role_assigned", "payment_verified", "material_list_signed_off", "everything_ordered", "everything_made", "snags_closed", "no_critical_snags"] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];
export type StageCheck = { key: string; kind: CheckKind; label?: string; role?: string };
export type TemplateStage = { key: string; name: string; ownerRole: string | null; checks: StageCheck[] };

/** Checks read from records can't be skipped past: a stage holding one can only be finished. */
export const HARD_CHECKS: readonly CheckKind[] = ["payment_verified"];

export const DEFAULT_ROLES: ProjectRole[] = [
  { key: "project_manager", label: "Project manager" },
  { key: "account_manager", label: "Account manager" },
  { key: "designer", label: "Designer" },
  { key: "technical_designer", label: "Technical designer" },
  { key: "quantity_surveyor", label: "Quantity surveyor" },
  { key: "procurement", label: "Procurement" },
  { key: "site_supervisor", label: "Site supervisor" },
  { key: "factory_lead", label: "Factory lead" },
  { key: "installation_lead", label: "Installation lead" },
];

/** A generic delivery route. Firms rename, reorder, add or remove stages in Settings → Projects. */
export const DEFAULT_STAGES: TemplateStage[] = [
  { key: "kickoff", name: "Kickoff", ownerRole: "project_manager", checks: [
    { key: "lead", kind: "lead_assigned" },
    { key: "meeting", kind: "confirm", label: "Kickoff meeting held with the client" },
  ] },
  { key: "materials", name: "Material sign-off", ownerRole: "designer", checks: [
    { key: "signed", kind: "material_list_signed_off" },
  ] },
  { key: "procurement", name: "Procurement", ownerRole: "procurement", checks: [
    { key: "ordered", kind: "everything_ordered" },
  ] },
  { key: "drawings", name: "Technical drawings", ownerRole: "technical_designer", checks: [
    { key: "approved", kind: "confirm", label: "Client approved the drawings" },
  ] },
  { key: "production", name: "Production", ownerRole: "factory_lead", checks: [
    { key: "payment", kind: "payment_verified" },
    { key: "done", kind: "everything_made" },
  ] },
  { key: "installation", name: "Delivery and installation", ownerRole: "installation_lead", checks: [
    { key: "installed", kind: "confirm", label: "Everything delivered and installed" },
  ] },
  { key: "snagging", name: "Snagging", ownerRole: "project_manager", checks: [
    { key: "closed", kind: "snags_closed" },
  ] },
  { key: "handover", name: "Handover", ownerRole: "project_manager", checks: [
    { key: "critical", kind: "no_critical_snags" },
    { key: "accepted", kind: "confirm", label: "Client accepted the handover" },
  ] },
];

const KEY = /^[a-z][a-z0-9_]{0,63}$/;

export function slug(value: string) {
  const base = value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return /^[a-z]/.test(base) ? base : `s_${base || "stage"}`.slice(0, 64);
}

function text(value: unknown, label: string, max: number) {
  if (typeof value !== "string" || !value.trim()) throw new BadRequestException(`${label} is required.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new BadRequestException(`${label} is too long.`);
  return trimmed;
}

/** Validates the firm's role list. The lead role is always there. */
export function parseRoles(input: unknown): ProjectRole[] {
  if (!Array.isArray(input) || !input.length || input.length > 30) throw new BadRequestException("Add between 1 and 30 roles.");
  const roles = input.map((raw, index) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const label = text(row.label, `Role ${index + 1}`, 60);
    const key = typeof row.key === "string" && KEY.test(row.key) ? row.key : slug(label);
    return { key, label };
  });
  if (new Set(roles.map((role) => role.key)).size !== roles.length) throw new BadRequestException("Each role needs a different name.");
  if (!roles.some((role) => role.key === LEAD_ROLE)) throw new BadRequestException("Keep the project manager role; it leads the project.");
  return roles;
}

/** Validates a stage template against the firm's roles. */
export function parseStages(input: unknown, roles: ProjectRole[]): TemplateStage[] {
  if (!Array.isArray(input) || input.length < 2 || input.length > 20) throw new BadRequestException("A route needs between 2 and 20 stages.");
  const roleKeys = new Set(roles.map((role) => role.key));
  const stages = input.map((raw, index) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const name = text(row.name, `Stage ${index + 1}`, 120);
    const key = typeof row.key === "string" && KEY.test(row.key) ? row.key : slug(name);
    const ownerRole = row.ownerRole === null || row.ownerRole === undefined || row.ownerRole === "" ? null : String(row.ownerRole);
    if (ownerRole && !roleKeys.has(ownerRole)) throw new BadRequestException(`${name}: choose an owner from the project roles.`);
    if (!Array.isArray(row.checks) || row.checks.length > 12) throw new BadRequestException(`${name}: add up to 12 checks.`);
    const given = new Set(row.checks.map((rawCheck) => (rawCheck as Record<string, unknown> | null)?.key).filter((key): key is string => typeof key === "string" && KEY.test(key)));
    const freshKey = (kind: string) => { let n = 1; while (given.has(`${kind}_${n}`)) n++; given.add(`${kind}_${n}`); return `${kind}_${n}`; };
    const checks = row.checks.map((rawCheck, checkIndex) => {
      const check = (rawCheck ?? {}) as Record<string, unknown>;
      const kind = check.kind as CheckKind;
      if (!CHECK_KINDS.includes(kind)) throw new BadRequestException(`${name}: unknown check.`);
      const parsed: StageCheck = { key: typeof check.key === "string" && KEY.test(check.key) ? check.key : freshKey(kind), kind };
      if (kind === "confirm") parsed.label = text(check.label, `${name}: check ${checkIndex + 1}`, 200);
      if (kind === "role_assigned") {
        if (typeof check.role !== "string" || !roleKeys.has(check.role)) throw new BadRequestException(`${name}: choose which role must be named.`);
        parsed.role = check.role;
      }
      return parsed;
    });
    if (new Set(checks.map((check) => check.key)).size !== checks.length) throw new BadRequestException(`${name}: each check must be different.`);
    return { key, name, ownerRole, checks };
  });
  if (new Set(stages.map((stage) => stage.key)).size !== stages.length) throw new BadRequestException("Each stage needs a different name.");
  return stages;
}

export type CheckFacts = {
  /** Role keys that have a person named on the project. */
  filledRoles: Set<string>;
  /** Check keys confirmed on this stage. */
  confirmed: Set<string>;
  /** Payments marked "before production" on the accepted quote are verified (true when none are marked). */
  productionPaid: boolean;
  /** The latest material list revision is signed off and unchanged since. */
  materialsSignedOff: boolean;
  /** Every material and bought scope line is covered by placed purchase orders. */
  everythingOrdered: boolean;
  /** Every scope line made in the factory has passed its checks in full. */
  everythingMade: boolean;
  /** Snags on the project that aren't closed: all of them, and the critical ones. */
  openSnags: number; openCriticalSnags: number;
};

/** Whether a check passes, from the facts gathered for the stage. */
export function checkPasses(check: StageCheck, facts: CheckFacts) {
  switch (check.kind) {
    case "confirm": return facts.confirmed.has(check.key);
    case "lead_assigned": return facts.filledRoles.has(LEAD_ROLE);
    case "role_assigned": return Boolean(check.role && facts.filledRoles.has(check.role));
    case "payment_verified": return facts.productionPaid;
    case "material_list_signed_off": return facts.materialsSignedOff;
    case "everything_ordered": return facts.everythingOrdered;
    case "everything_made": return facts.everythingMade;
    case "snags_closed": return facts.openSnags === 0;
    case "no_critical_snags": return facts.openCriticalSnags === 0;
  }
}
