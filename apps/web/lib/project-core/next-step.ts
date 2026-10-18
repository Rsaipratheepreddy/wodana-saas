import { tKey, type MessageKey, type Translate } from "@/lib/i18n/keys";
import type { CheckKind, Health, NextStep, ProjectRow } from "./types";

/**
 * A project's next step as something to do ("Confirm installation", "Book a factory slot"), not the state it waits
 * for. A firm's own check ("confirm") keeps its words; naming a role keeps the server's "Name the …".
 */
const NEXT_STEP_ACTION: Partial<Record<CheckKind | "finish", MessageKey>> = {
  lead_assigned: tKey("Name the project manager"),
  payment_verified: tKey("Verify the production payment"),
  material_list_signed_off: tKey("Get the material list signed off"),
  everything_ordered: tKey("Order the remaining materials"),
  everything_made: tKey("Finish and check production"),
  snags_closed: tKey("Close the open snags"),
  no_critical_snags: tKey("Close the critical snags"),
  handover_accepted: tKey("Get the handover accepted"),
  drawings_uploaded: tKey("Upload the technical drawings"),
  drawings_site_checked: tKey("Check the drawings on site"),
  technical_measure_done: tKey("Take the technical site measure"),
  drawings_design_checked: tKey("Check the drawings match the design"),
  drawings_client_approved: tKey("Get the drawings approved"),
  factory_slot_booked: tKey("Book a factory slot"),
  installation_scheduled: tKey("Schedule the installation"),
  goods_delivered: tKey("Complete the delivery"),
  installation_done: tKey("Confirm installation"),
  permit_collected: tKey("Collect the building permit"),
  finish: tKey("Finish {stage}"),
};

/** The next step in the person's language. */
export function nextStepText(t: Translate, next: Pick<NextStep, "kind" | "text" | "stage">) {
  const action = NEXT_STEP_ACTION[next.kind];
  return action ? t(action, { stage: next.stage }) : t(next.text as MessageKey);
}

/** A running project with late work is at risk even when nobody has flagged it: the status follows the late count. */
export function effectiveHealth(row: Pick<ProjectRow, "status" | "health" | "attention">): Health {
  return row.status === "active" && row.health === "on_track" && (row.attention?.late ?? 0) > 0 ? "at_risk" : row.health;
}
