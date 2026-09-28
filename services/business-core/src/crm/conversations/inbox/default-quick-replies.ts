import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

/**
 * The team quick replies every workspace starts with (typed after "/" in a chat). Worded for any firm and any
 * country: no names, currency or places. Migration 0157 gave existing workspaces the same set.
 */
export const DEFAULT_QUICK_REPLIES: ReadonlyArray<{ shortcut: string; body: string }> = [
  { shortcut: "thanks", body: "Thanks for your message, {{contact.first_name}}. We have received it and will get back to you shortly." },
  { shortcut: "floorplan", body: "Could you share your floor plan? A photo or a PDF is fine. It helps us plan the space and prepare an accurate quotation." },
  { shortcut: "sitevisit", body: "We would like to visit the site. Which day and time suit you best? A visit usually takes about an hour." },
  { shortcut: "quotation", body: "Your quotation has been sent. Take your time to review it, and let us know if you have any questions." },
  { shortcut: "payment", body: "The payment details and the amount due are on your invoice. Please share the receipt here once it is done, and we will confirm it." },
  { shortcut: "handover", body: "Your project is nearly ready for handover. Which day and time work for you to walk through it with us?" },
];

/** Adds the default team quick replies the workspace doesn't have yet (an archived one stays archived). Safe to repeat. */
export async function seedDefaultQuickReplies(db: Db, workspaceId: string) {
  let added = 0;
  for (const reply of DEFAULT_QUICK_REPLIES) {
    const result = await db.query(
      `INSERT INTO crm_quick_replies (workspace_id, owner_membership_id, shortcut, body)
       SELECT $1, NULL, $2, $3
        WHERE NOT EXISTS (SELECT 1 FROM crm_quick_replies WHERE workspace_id = $1 AND owner_membership_id IS NULL AND shortcut = $2)`,
      [workspaceId, reply.shortcut, reply.body]);
    added += result.rowCount ?? 0;
  }
  return added;
}
