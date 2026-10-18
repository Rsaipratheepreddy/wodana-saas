import type { PoolClient } from "pg";
import { loadLeadOptions, REGION_OTHER } from "./lead-options";

type Location = { emirate?: string; area?: string; location?: string };
type Choices = Pick<Awaited<ReturnType<typeof loadLeadOptions>>, "emirates" | "areas">;

/**
 * Guide B: "Customer Name · Area, Region" (or "· Region", "· typed place"); the name alone without a place. Lists put the
 * enquiry's locked reference in front of it, so a row reads "Ref · Client · Area, Region" with nothing said twice.
 */
export function enquiryTitle(customerName: string, details: Location, choices: Choices): string {
  const name = customerName.trim();
  const emirate = choices.emirates.find(option => option.id === details.emirate)?.label
    ?? details.emirate?.replaceAll("_", " ") ?? "";
  const area = (details.area || details.location || "").trim();
  const areaName = choices.areas[details.emirate ?? ""]?.find(option => option.id === area)?.label ?? area;
  const place = details.emirate === REGION_OTHER ? areaName || emirate : [areaName, emirate].filter(Boolean).join(", ");
  if (!place) return name.slice(0, 240);
  if (!name) return place.slice(0, 240);
  return `${name} · ${place}`.slice(0, 240);
}

export async function refreshEnquiryTitlesForParty(client: PoolClient, workspaceId: string, partyId: string, customerName: string): Promise<void> {
  const choices = await loadLeadOptions(client, workspaceId);
  const enquiries = await client.query<{ id: string; details: Location }>(
    `SELECT id, details FROM crm_enquiries WHERE workspace_id=$1 AND party_id=$2`, [workspaceId, partyId],
  );
  for (const enquiry of enquiries.rows) {
    await client.query(
      `UPDATE crm_enquiries SET title=$3, updated_at=now() WHERE workspace_id=$1 AND id=$2 AND title IS DISTINCT FROM $3`,
      [workspaceId, enquiry.id, enquiryTitle(customerName, enquiry.details ?? {}, choices)],
    );
  }
}
