import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

/**
 * The team quick replies every workspace starts with (typed after "/" in a chat), from the first hello to the review
 * after handover. Worded for any firm and any country: no names, currency or places; fields fill from the chat's
 * records. Migration 0157 gave existing workspaces the first six; the rest arrive the next time the team opens its
 * quick replies.
 */
export const DEFAULT_QUICK_REPLIES: ReadonlyArray<{ shortcut: string; body: string }> = [
  { shortcut: "thanks", body: "Thanks for your message, {{contact.first_name}}. We have received it and will get back to you shortly." },
  { shortcut: "floorplan", body: "Could you share your floor plan? A photo or a PDF is fine. It helps us plan the space and prepare an accurate quotation." },
  { shortcut: "sitevisit", body: "We would like to visit the site. Which day and time suit you best? A visit usually takes about an hour." },
  { shortcut: "quotation", body: "Your quotation has been sent. Take your time to review it, and let us know if you have any questions." },
  { shortcut: "payment", body: "The payment details and the amount due are on your invoice. Please share the receipt here once it is done, and we will confirm it." },
  { shortcut: "handover", body: "Your project is nearly ready for handover. Which day and time work for you to walk through it with us?" },
  { shortcut: "hi", body: "Hi {{contact.first_name}}, thank you for contacting {{business.name}}. I'm {{staff.first_name}} and I'll be helping you with your project. How can we help today?" },
  { shortcut: "welcome", body: "Welcome to {{business.name}}, {{contact.first_name}}! Tell us a little about your space: the property type, the rooms you'd like to design and when you'd like to move in." },
  { shortcut: "about", body: "{{business.name}} takes care of the whole interior: design, approvals, joinery, fit-out and handover, managed by one team. You can follow every step in your client portal." },
  { shortcut: "details", body: "To get started, could you share the property location, its size or number of rooms, your budget range and your preferred timeline?" },
  { shortcut: "budget", body: "Do you have a budget range in mind? It helps us suggest the right materials and finishes from the start." },
  { shortcut: "photos", body: "Could you share a few photos or a short video of the space as it is today?" },
  { shortcut: "inspiration", body: "If you have inspiration images or styles you like, please share them here. We'll use them for your moodboard." },
  { shortcut: "call", body: "Would a quick call help? Let us know a day and time that suits you, and we'll call you." },
  { shortcut: "confirmed", body: "Your appointment is confirmed for {{meeting.time}}. See you then!" },
  { shortcut: "reminder", body: "A quick reminder about our appointment on {{meeting.time}}. Please let us know if you need to change it." },
  { shortcut: "followup", body: "Hi {{contact.first_name}}, just following up on our last conversation. Is there anything else we can help you with?" },
  { shortcut: "checking", body: "Thanks for waiting, {{contact.first_name}}. I'm checking this with the team and will come back to you shortly." },
  { shortcut: "design", body: "Your designs are ready for review in your client portal: {{portal.link}} Please approve each one or leave your comments on it." },
  { shortcut: "portal", body: "You can follow your project, approve designs and quotations, and see your invoices in your client portal: {{portal.link}} Sign in with your mobile number." },
  { shortcut: "approve", body: "Could you review and approve the latest item in your client portal? {{portal.link}}" },
  { shortcut: "invoice", body: "Invoice {{invoice.number}} for {{invoice.total}} is ready, due on {{invoice.due_date}}. You can view and download it in your client portal: {{portal.link}}" },
  { shortcut: "received", body: "Thank you, we have received your payment. Your receipt will be in your client portal shortly." },
  { shortcut: "update", body: "A quick update on {{project.name}}: we are now in the {{project.stage}} stage. Photos and progress are in your client portal." },
  { shortcut: "issue", body: "Sorry about this, {{contact.first_name}}. Could you share a photo and a short description? We'll log it and arrange a visit." },
  { shortcut: "review", body: "Thank you for choosing {{business.name}}! If you enjoyed working with us, we'd be grateful for a short review: {{review.link}}" },
  { shortcut: "bye", body: "Thank you, {{contact.first_name}}. Have a great day!" },
];

/** Adds the default team quick replies the workspace doesn't have yet (an archived one stays archived). Safe to repeat. */
export async function seedDefaultQuickReplies(db: Db, workspaceId: string) {
  const result = await db.query(
    `INSERT INTO crm_quick_replies (workspace_id, owner_membership_id, shortcut, body)
     SELECT $1::uuid, NULL::uuid, seed.shortcut, seed.body
       FROM unnest($2::varchar[], $3::text[]) AS seed (shortcut, body)
      WHERE NOT EXISTS (SELECT 1 FROM crm_quick_replies existing
                         WHERE existing.workspace_id = $1::uuid AND existing.owner_membership_id IS NULL AND existing.shortcut = seed.shortcut)`,
    [workspaceId, DEFAULT_QUICK_REPLIES.map((reply) => reply.shortcut), DEFAULT_QUICK_REPLIES.map((reply) => reply.body)]);
  return result.rowCount ?? 0;
}
