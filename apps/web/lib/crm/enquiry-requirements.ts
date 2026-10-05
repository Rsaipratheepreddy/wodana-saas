import type { SaveProblem } from "@/design-system";
import { tKey, translateKnown, type MessageKey, type Translate } from "@/lib/i18n/keys";
import { crmRequest } from "./client";
import type { LeadOptions, RequiredAt } from "./lead-options";

/** The gates an enquiry passes, in order; a field required at one is required at every later one (PLM-096). */
const GATES: RequiredAt[] = ["create", "convert", "book_intro"];

/** Whether the type requires this field by the gate. */
export function requiredBy(options: LeadOptions | undefined, serviceType: string, key: string, gate: Exclude<RequiredAt, "never">) {
  const at = options?.requirements?.[serviceType]?.[key];
  return Boolean(at && at !== "never" && GATES.indexOf(at) <= GATES.indexOf(gate));
}

/** The choices for when a field is required, in gate order. */
export const REQUIRED_AT_CHOICES: Array<{ id: RequiredAt; label: MessageKey }> = [
  { id: "never", label: tKey("Not required") },
  { id: "create", label: tKey("At creation") },
  { id: "convert", label: tKey("Before converting") },
  { id: "book_intro", label: tKey("Before the intro") },
];

/** The team roles an enquiry can tag (PLM-100), as the product names them. */
export const TEAM_ROLE_LABELS: Record<string, MessageKey> = {
  designer: tKey("Designer"),
  project_manager: tKey("Project manager"),
  quantity_surveyor: tKey("Quantity surveyor"),
  factory_lead: tKey("Factory lead"),
};
export const teamRoleLabel = (role: string, t: Translate) => TEAM_ROLE_LABELS[role] ? t(TEAM_ROLE_LABELS[role]) : role.replaceAll("_", " ");

/**
 * A problem in the person's words: known fields read from the workspace (its region word, its team roles, its own
 * fields); anything else is the server's message, translated when known.
 */
export function problemText(problem: SaveProblem, t: Translate, context: { regionLabel?: string; customLabels?: Record<string, string> } = {}) {
  if (problem.key === "emirate" && context.regionLabel) return t("Select the {area}.", { area: context.regionLabel.toLocaleLowerCase() });
  if (problem.key.startsWith("team:")) return t("Tag the {role}, or choose Not applicable", { role: teamRoleLabel(problem.key.slice(5), t).toLocaleLowerCase() });
  if (problem.key.startsWith("cf:") && context.customLabels?.[problem.key.slice(3)]) return t("Fill in {field}", { field: context.customLabels[problem.key.slice(3)] });
  return translateKnown(t, problem.label);
}

export type RequirementState = { rules: Record<string, Record<string, RequiredAt>>; versions: Record<string, Record<string, number>> };
export const loadRequirements = (workspaceId: string, signal?: AbortSignal) => crmRequest<RequirementState>(workspaceId, "enquiry-requirements", "GET", undefined, signal);
export const saveRequirement = (workspaceId: string, fieldKey: string, types: Array<{ enquiryType: string; requiredAt: RequiredAt; version: number }>) =>
  crmRequest<RequirementState>(workspaceId, `enquiry-requirements/${encodeURIComponent(fieldKey)}`, "PUT", { types });
