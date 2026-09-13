# Leads flow implementation

Status: deployed and verified on 8 September 2026 at https://iglo.wodana.ai. Release `20260908-leads-forms`. See [release details](leads-forms-release-20260908.md).

The reference is the Palm Living Lead Flow CRM Requirements Report. Its business requirements
are applied to the Wodana/Iglo theme. Forms are native, shareable customer enquiry forms,
not Google Forms. Enquiry is part of Leads, not a separate navigation section.

## Flow

Staff entry / customer form (link or QR) → validation and idempotency
→ identity matching → duplicate review if needed → customer and enquiry E-0001 → lead
→ explicit salesperson, automatic routing or unassigned → follow-ups → qualified into
pre-execution, disqualified with reason, or continued discussion.

## Acceptance checklist

- [x] 1–3: Separate controlled source and source-specific channel, including all report combinations.
- [x] 4: Manual, form and automated intake remain distinct; integrations retain event identity.
- [x] 5: QR walk-in routes automatically; staff walk-in supports a selected salesperson.
- [x] 6: Customer types use centrally configured options; no unapproved list is invented.
- [x] 7: Eight enquiry types; Service label replaced with Enquiry Type.
- [x] 8: Permanent workspace-scoped E-0001 reference, optional title; customer/contact,
      company, job, website, address, location, enquiry, campaign and assignment fields.
- [x] 8.1: Optional controlled budget band including Not sure yet.
- [x] 9: Public form exposes customer fields only; name, mobile, email and location required.
- [x] 10–11: Routing matches source + channel + intake; explicit initial choices are respected.
- [x] 12: Intake processing state, errors and processed timestamp are distinct from sales stage.
- [x] 13: Email, mobile, phone and name matching; review preserves original submissions.
- [x] 14: Source paths verified through manual, form and integration entry.
- [x] 15: Volume, source/channel, enquiry/customer type, budget, owner/team, unassigned,
      conversion/loss, processing/duplicates, walk-in paths and freshness reporting.
- [x] 16–19: Original attribution, governed options, audit/history, operational follow-ups
      and qualification/pre-execution links verified.
- [x] 20: Unresolved business choices remain configurable and documented.
- [x] 21: Source, channel, intake method and assignment method visible independently.
- [x] Tests: concurrent references/submissions, validation, duplicate decisions, RBAC and tenant
      isolation, routing, editing/version conflicts, filters/export, public forms, UI and build.
- [x] Complete local, staged and live verification; deploy after the user’s later explicit request.

## Defaults for unresolved report choices

Budget and description are optional. Customer types start empty and are managed in Options. PlyLeads routing is configurable; a
provider connection and its business routing choice still need to be supplied. Existing sales stages and qualification behavior remain the
operational definition of conversion; downstream won/lost reporting is separate. Public forms
are configurable and initially drafts. No demo data is deleted by this work.

Forms builder: editable question cards, add/duplicate/delete, required controls, drag ordering plus keyboard movement, question types, preview, draft/published revisions, share link and QR. Keep current portal design-system theme.


## Verification and review

- Core unit suite: 280 passed, 10 pre-existing integration tests skipped.
- Web unit suite: 465 passed. Stale tests were updated for the existing shared view selector,
  Chats heading and Quotation Templates navigation; the lead creation tests cover the new form.
- Local API workflow checks: 28 passed, using a disposable workspace and no outbound messaging.
- Local database checks: 5 passed, covering immutable references, numbering above 9999,
  read-only CRM permissions, tenant/public-form RLS and delayed assignment events.
- Browser: create lead; editable question cards; multiple choice; required fields; keyboard
  reordering; unsaved-change protection; draft save; preview; local form publication; QR;
  anonymous mobile submission; readable responses; reports; configurable customer types.
- Core compilation, web production build and lint of the changed frontend files passed.
- No colored card borders. Selection uses a neutral background; action buttons retain the
  portal gradient. Existing shared table controls are used for Leads, Forms, Responses and Reports.

The local review app runs at http://127.0.0.1:8152/workspace/crm/leads against a separate test
database. These QA records and form links are local only. Migration 0049 is applied to production.
The normal local development database is separate from the verified test database.

Reproducible API checks: `services/business-core/scripts/smoke-lead-flow.mjs` accepts
`LEAD_FLOW_TEST_API`, `LEAD_FLOW_TEST_INTERNAL_TOKEN`, and optional `LEAD_FLOW_TEST_RESULTS`.
It refuses non-local API hosts and creates disposable test workspaces. The database companion,
`services/business-core/scripts/verify-lead-flow-database.mjs`, requires the result file and
`LEAD_FLOW_TEST_DB` pointing to a disposable local database with `lead_flow` in its name.

## Connection and business decisions

WhatsApp enquiries can be entered manually or captured through a form link. The controlled
integration endpoint supports automated intake and retry-safe provider event IDs. This change
does not implement the automatic bridge from WhatsApp/Gmail Inbox messages into Leads.
Existing provider connections bring messages into Inbox; connecting alone does not yet create
a Lead. That adapter work remains pending. PlyLeads capture also needs its provider adapter
and the agreed routing configuration.

Campaign is a structured text field. Location is a separate searchable field. Duplicate matching
checks existing customers without a time window; verified exact matches can link automatically,
while unverified matches require review. Existing lifecycle names and the qualification to
pre-execution flow are retained. Stale reporting currently uses 7 days since a meaningful record
or activity update. Budget and project description remain optional because the reference contains
conflicting required-field instructions; its explicit optional-field guidance is followed.

Forms retain a published snapshot until republished. Existing enquiries retain removed option
codes; their other details can still be edited. Not Sure Yet remains an available enquiry choice.
Custom answers are saved alongside the mapped customer and enquiry fields. Future channels
and customer types can be added in Options without changing the data model.
