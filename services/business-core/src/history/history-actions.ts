/**
 * What an audit action means to a person reading a record's history: one verb ("approved", "sent") and the filter it
 * belongs to (a change, a message, an approval). Actions are dotted codes written by every module
 * ("purchase_order.approve", "quotation.sent_to_qs.v1", "project.complete_stage"); the verb comes from the code's
 * last part, so a new action reads sensibly without a change here. One that matches nothing reads as "updated".
 * Keep `HISTORY_VERBS` in step with packages/contracts/src/history.ts (history-contract.spec.ts checks it).
 */
export const HISTORY_VERBS = [
  "created", "updated", "removed", "sent", "submitted", "approved", "declined", "decided", "verified", "signed", "requested_approval",
  "requested_signature", "sent_for_review", "returned", "cancelled", "closed", "completed", "started", "issued", "raised", "assigned", "reassigned",
  "numbered", "uploaded", "commented", "messaged", "logged_contact", "posted_update", "paid", "received", "scheduled", "priced", "applied", "won",
  "lost", "qualified", "held", "reopened", "released", "dispatched", "checked", "confirmed", "escalated", "expired", "reacted", "advanced", "followed_up", "not_sent",
] as const;
export type HistoryVerb = (typeof HISTORY_VERBS)[number];
export type HistoryCategory = "change" | "message" | "approval";

const APPROVALS = new Set<HistoryVerb>(["approved", "declined", "decided", "verified", "signed", "requested_approval", "requested_signature", "sent_for_review", "returned"]);
const MESSAGES = new Set<HistoryVerb>(["commented", "messaged", "logged_contact", "posted_update", "reacted"]);

/** Ordered: the first rule whose pattern matches the action (without its ".vN") gives the verb. */
const RULES: Array<[RegExp, HistoryVerb]> = [
  [/^commercial\.(issue|resend)$/, "sent"],
  [/^commercial\.execute_agreement$/, "signed"],
  [/^commercial\.(submit_owner_review|submit_material_approval)$/, "submitted"],
  [/^commercial\.review_deal_finance$/, "checked"],
  [/^commercial\.(revise|variation|create_change_case)$/, "created"],
  [/^commercial\.request$/, "raised"],
  [/(^|[._])verify_[a-z_]+$/, "verified"],
  [/(^|[._])(payment|report_payment_receipt)$/, "paid"],
  [/(^|[._])attach_[a-z_]+$/, "uploaded"],
  [/(^|[._])withdraw_[a-z_]+$/, "cancelled"],
  [/(^|[._])restart_[a-z_]+$/, "reopened"],
  [/(^|[._])accept(ed)?$/, "approved"],
  [/(^|[._])(collected|collect)$/, "received"],
  [/(^|[._])(published|publish)$/, "issued"],
  [/(^|[._])(prepared|draft_prepared|suggest_[a-z_]+)$/, "created"],
  [/safety_incident$|^client_portal\.request$/, "raised"],
  [/(^|[._])delegated$/, "assigned"],
  [/(^|[._])add_[a-z_]+$/, "created"],
  [/(^|[._])issue_[a-z_]+$/, "issued"],
  [/(^|[._])confirm_[a-z_]+$/, "confirmed"],
  [/email_not_sent$/, "not_sent"],
  [/(^|[._])chased$/, "followed_up"],
  [/(^|[._])changing$/, "reopened"],
  [/(hold|funds)_override$|continued_on_hold$/, "approved"],
  [/funds_asked$/, "requested_approval"],
  [/^finance_request\.approval$/, "decided"],
  [/^finance_request\.needs_info$/, "returned"],
  [/^finance_request\.file$/, "uploaded"],
  [/(^|[._])(emailed|return_emailed)$/, "sent"],
  [/(over_funds|under_threshold|alternate_offered)$/, "updated"],
  [/client_(accept|approve)$/, "approved"],
  [/client_message$/, "messaged"],
  [/client_(request|answered|question_on_the_daily_progress)$/, "raised"],
  [/(^|[._])set_[a-z_]+$/, "updated"],
  [/(^|[._])won$/, "won"],
  [/(^|[._])lost$/, "lost"],
  [/sent_to_qs$|(internal|client)_review$|^approvals\.reset$/, "sent_for_review"],
  [/qs_returned$|(^|[._])return(ed)?$|daily_report\.returned$/, "returned"],
  [/signature_requested$/, "requested_signature"],
  [/signature_revoked$|withdrawn?$|presentation_withdrawn$/, "cancelled"],
  [/(^|[._])signed(_off)?$/, "signed"],
  [/^approvals\.requested$|approval_req(uested)?$/, "requested_approval"],
  [/approve_send$/, "sent"],
  [/(^|[._])(approved?|step_approved|internal_approved|qs_confirmed|changes_approved|approve_[a-z_]+|[a-z_]+_approved)$/, "approved"],
  [/(^|[._])(declined?|reject(ed)?|disqualified|candidate_rejected|marked_spam)$/, "declined"],
  [/(^|[._])(decid(e|ed)|decide_[a-z_]+|[a-z_]+_decided|[a-z_]+_decision|decision_recorded|quote_decision_recorded)$/, "decided"],
  [/(^|[._])(verif(y|ied)|payment_verified)$/, "verified"],
  [/(^|[._])qualified$|client_confirmed$/, "qualified"],
  [/(^|[._])(comment(_added)?|board_comment|replied|moodboard_replied|reply)$/, "commented"],
  [/(^|[._])react$/, "reacted"],
  [/(message\.created|sent_from_phone|schedule_sent|auto_reply\.sent|demo_message|email_received|customer\.replied|client_message\.[a-z_]+)$/, "messaged"],
  [/contact_logged$|requirement_note_saved$/, "logged_contact"],
  [/post_update$/, "posted_update"],
  [/number_assigned$/, "numbered"],
  [/(^|[._])(raised|raise(_[a-z_]+)?|finance_request_raised|claimed|warranty_claim)$/, "raised"],
  [/(^|[._])(paid|reimburse|report_payment|payment_recorded|recorded_payment|fulfilment_recorded|payment\.recorded)$/, "paid"],
  [/(^|[._])(resent|sent|send(_[a-z_]+)?|shared|moodboard_shared|digest_sent|reminder\.sent|presented)$/, "sent"],
  [/(^|[._])(submitted|submit)$/, "submitted"],
  [/(^|[._])(cancelled|cancel)$/, "cancelled"],
  [/(^|[._])(closed|close|subject_closed)$/, "closed"],
  [/(^|[._])(completed|complete(_[a-z_]+)?|finish(_[a-z_]+)?|materials_ready|site_visit_completed)$/, "completed"],
  [/(^|[._])(phase_advanced|stage_changed|engagement_phase_changed)$/, "advanced"],
  [/(^|[._])(started|start(_[a-z_]+)?|case_started|journey_started)$/, "started"],
  [/(^|[._])(issued|issue|proposal_pdf_issued|create_pack)$/, "issued"],
  [/(^|[._])(reassigned|reassign|subject_reassigned|qs_reassigned|host_reassigned)$/, "reassigned"],
  [/(^|[._])(assigned|assign(_[a-z_]+)?|set_member|member_updated|designer_changed|stage_assigned|team_member_updated|stakeholder_updated)$/, "assigned"],
  [/(^|[._])(uploaded|upload|file_added|asset_uploaded|photo_added|drawing_uploaded|[a-z_]+_attached|image_added|version_added|document_version_added|external_uploaded|attachment_[a-z_]+)$/, "uploaded"],
  [/(^|[._])(received|receive)$/, "received"],
  [/(^|[._])(scheduled|schedule_[a-z_]+|rescheduled|booked|book(_[a-z_]+)?|[a-z_]+_booked|appointment\.changed|schedule\.updated)$/, "scheduled"],
  [/(^|[._])priced$/, "priced"],
  [/(^|[._])(applied|change_applied)$/, "applied"],
  [/(^|[._])(hold|held|paused|snoozed|subject_snoozed)$/, "held"],
  [/(^|[._])(resumed|resume|woke|woken|unsnoozed|subject_unsnoozed|reopened|duplicate_reopened)$/, "reopened"],
  [/(^|[._])(released?)$/, "released"],
  [/(^|[._])(dispatch(ed)?)$/, "dispatched"],
  [/(^|[._])(inspected|check(ed)?|confirm_check|check_drawings|review(ed)?)$/, "checked"],
  [/(^|[._])(confirmed|confirm)$/, "confirmed"],
  [/(^|[._])(escalated|[a-z_]+_escalated|sla\.breached|sla\.warning)$/, "escalated"],
  [/(^|[._])expired$/, "expired"],
  [/(^|[._])(created|create|added|entered|new|planned|ready|entry_added|room_saved|[a-z_]+_created)$/, "created"],
  [/(^|[._])(deleted|removed|archived|discarded|erased|[a-z_]+_removed|[a-z_]+_archived)$/, "removed"],
  [/(^|[._])(updated|update|changed|saved|save(_[a-z_]+)?|set|edited|arranged|marked|pinned|report|[a-z_]+_(updated|changed|saved|set|pinned|migrated|linked|prefilled|extended))$/, "updated"],
  [/(amended|merged|renamed|restored|imported|installed|labelled|filed|hidden|blocked|resolved|detected|returning_customer|kept|skipped|undone|exported|shown|seeded|split|rolled_back|reset|answered|not_required|overridden|executed|enabled|disabled|failed|requested|access|read_thread|confirm_name|replaced|status|turned_on|recorded|provisioned|invited|ended|revoked|registered|prepared|suppressed|callback|allocate|add|check_in|check_out|enrolled|project_task|set_up|insights|regenerated|pushed|activated|step\.executed|digest|read|dismissed|review_required|reversed|stopped|added_to_catalog)$/, "updated"],
];

/** The verb and filter for an audit action; `known` is false when only the "updated" fallback applies. */
export function describeAction(action: string): { verb: HistoryVerb; category: HistoryCategory; known: boolean } {
  const code = action.trim().toLowerCase().replace(/\.v\d+$/, "");
  const rule = RULES.find(([pattern]) => pattern.test(code));
  const verb = rule?.[1] ?? "updated";
  return { verb, category: APPROVALS.has(verb) ? "approval" : MESSAGES.has(verb) ? "message" : "change", known: Boolean(rule) };
}
