/**
 * PLM-151: the design team of one job. There are no fixed pairs: once the design fee is paid the Account Manager
 * allocates the lead designer, the junior designer and the Sales Admin on the case; the lead designer tags the
 * Visualiser and the technical lead tags the Draftsman. On a package with a reviewer (Palm: the Creative Director) the
 * reviewer chooses the lead designer. Each slot is a team role on the record (project_assignments.role_keys); which role
 * key a slot uses is the firm's configuration (workspace_design_settings), with these defaults.
 */
export const TEAM_SLOTS = ["lead_designer", "junior_designer", "sales_admin", "visualiser", "draftsman", "material_coordinator"] as const;
export type TeamSlot = (typeof TEAM_SLOTS)[number];

export type DesignTeamConfig = Record<TeamSlot, string | null> & {
  /** The workspace role or team code whose members tag the Draftsman (Palm: the Technical Lead). */
  technicalLeadRoleCode: string | null;
};

export const DEFAULT_DESIGN_TEAM: DesignTeamConfig = {
  lead_designer: "designer", junior_designer: "junior_designer", sales_admin: "sales_admin", visualiser: "visualiser", draftsman: "draftsman",
  material_coordinator: "material_coordinator", technicalLeadRoleCode: "technical_lead",
};

/** The slots the allocation step asks the Account Manager (or the reviewer) for, once the fee is paid. */
export const ALLOCATION_SLOTS: readonly TeamSlot[] = ["lead_designer", "junior_designer", "sales_admin"];
/** Slots of designers: changing who holds one after it was allocated needs a reason (kept in the history). */
export const DESIGNER_SLOTS: readonly TeamSlot[] = ["lead_designer", "junior_designer"];

export type Setter = "account_manager" | "reviewer" | "lead_designer" | "technical_lead";

/**
 * Who sets a slot. A workspace admin (who manages the Planning lifecycle) may set any of them; on a reviewed package
 * the reviewer, not the Account Manager, chooses the lead designer.
 */
export function slotSetters(slot: TeamSlot, reviewed: boolean): Setter[] {
  if (slot === "lead_designer") return reviewed ? ["reviewer"] : ["account_manager"];
  if (slot === "visualiser") return ["lead_designer"];
  if (slot === "draftsman") return ["technical_lead"];
  if (slot === "material_coordinator") return ["account_manager", "lead_designer"];
  return ["account_manager"];
}

/** The slots a person may set, from what they are on this job. */
export function settableSlots(roles: { admin: boolean; accountManager: boolean; reviewer: boolean; leadDesigner: boolean; technicalLead: boolean }, reviewed: boolean, slots: readonly TeamSlot[] = TEAM_SLOTS) {
  if (roles.admin) return [...slots];
  const held: Record<Setter, boolean> = { account_manager: roles.accountManager, reviewer: roles.reviewer, lead_designer: roles.leadDesigner, technical_lead: roles.technicalLead };
  return slots.filter((slot) => slotSetters(slot, reviewed).some((setter) => held[setter]));
}

/** The slots the allocation needs on this workspace: those it configures (a slot set to no role isn't asked). */
export const allocationSlots = (config: DesignTeamConfig) => ALLOCATION_SLOTS.filter((slot) => Boolean(config[slot]));

/** What the allocation still misses: each configured slot needs a person, or (all but the lead) "not needed on this job". */
export function allocationMissing(config: DesignTeamConfig, team: Map<string, { membershipId: string | null; notApplicable: boolean }>) {
  return allocationSlots(config).filter((slot) => {
    const choice = team.get(config[slot]!);
    if (!choice) return true;
    return slot === "lead_designer" ? !choice.membershipId : !choice.membershipId && !choice.notApplicable;
  });
}

const KEY = /^[a-z][a-z0-9_]{0,63}$/;

/** A settings value for a slot: a role key, or nothing (the slot isn't used). The lead designer always has one. */
export function teamConfigProblem(input: Partial<Record<TeamSlot | "technicalLeadRoleCode", string | null>>) {
  for (const [slot, value] of Object.entries(input)) {
    if (value === null || value === undefined || value === "") {
      if (slot === "lead_designer") return "Choose the lead designer's role";
      continue;
    }
    if (!KEY.test(value)) return "Use a role key of lower-case letters, numbers and underscores";
  }
  const keys = TEAM_SLOTS.map((slot) => input[slot]).filter((value): value is string => Boolean(value));
  if (new Set(keys).size !== keys.length) return "Give each part of the design team its own role";
  return null;
}
