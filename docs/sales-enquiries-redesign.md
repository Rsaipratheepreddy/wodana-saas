# Sales: enquiry working experience

Implement the first agreed slice: Enquiries as Sales landing, compact combined client/request table, personal/unassigned/attention views and a shared record inspector. Pipeline, Campaigns (existing forms), Reports and Settings remain connected destinations; full campaign orchestration is a later slice, not a claim of existing functionality.

Journey: request captured → eligible owner assigned → contact outcome logged → next follow-up → qualification → linked deal. Existing version checks, qualification gates, assignments and activity APIs remain authoritative. Contact shortcuts do not imply successful delivery or a logged response. Requirements data remains accessible until a linked Planning migration is implemented.

Default columns: client/request, stage, owner, next follow-up, source, last updated (not last contact: no authoritative contact timestamp in the list payload). Other fields remain available through the grid column picker. Mine uses authenticated membership identity; attention means active and unassigned, missing next action or overdue. Views apply to loaded records; pagination remains explicit.

API dependencies: GET leads and lead detail; POST assign/status/qualify; activities create/update; existing form/options/routing/report endpoints. No new client messages are sent by this change.

Record inspector: next-action strip, current owner, activity-first detail tabs, compact stage/qualification/edit actions. Preserve nested editor dialogs and their draft protection. Full-page expansion can follow when record routing is implemented without losing list state.

### Inline client matching
Manual enquiry creation keeps possible client matches in the original form. After intake finds a match, the draft is retained and its fields locked while the user chooses an existing client or a different person. Matching names are never silently merged. The form loads `intake-events/:id` and submits the selected candidate version to `duplicate-candidates/:id/review`; failures retain the selection for retry. Successful saves return to the table without opening another inspector. Row selection is disabled because the enquiry grid has no selection-based bulk operation.

Stage changes from the enquiry inspector now expand an inline editor, showing a reason only for disqualification and a next-follow-up field when an active unassigned enquiry requires it. Mutations retain version checks and backend transition validation. Assign/Reassign opens the shared searchable owner picker directly. Stage changes from the table that need additional information use a side sheet.

The enquiry overview leads with client identity and request, followed by a single stage/owner/follow-up property strip. Existing record tabs retain supporting information. The redundant owner/next-step table and crowded header action bar are removed; deal conversion is a separate next-step section. Missing contact information shows an actionable explanation instead of three disabled communication buttons.

Auto-assignment results are now inline above the table, with a direct searchable Choose owner action for each remaining enquiry and an Assignment settings link. Successfully assigned records leave that list. The obsolete Incoming enquiries footer button is removed. Enquiry properties use plain compact inline controls without a background card.

### Enquiry flow audit — 22 September 2026
The table and inspector share the follow-up action definition, carrying the actual lead, client and owner identifiers to POST activities. The inspector offers scheduling when no next action exists and refreshes its activity feed after changes. Details no longer repeats owner, next action, source/channel or project description; attribution remains in Source & history. Project description replaces the ambiguous Client request label. Deal conversion is hidden for ineligible records.

Stage selection remains a draft in the inline editor; the property shows the persisted stage until save succeeds. Stage and enquiry saves guard concurrent submissions. Assignment awaits its caller's refresh, retains an explicit saved state if refresh fails, and prevents resubmission. Existing version checks and duplicate-review API paths remain intact; no generated production records or placeholder backend responses were introduced.

Validation: 29 focused tests passed across leads-page, lead-enquiry-form, lead-assignment and crm-workbench, including a regression for successful assignment followed by failed refresh. Browser checked the live inspector and client-linked scheduling form. This audit covers the enquiry journey, not a certification of external calendar/email integrations or every Sales module. Full mobile/RTL regression and live external delivery were not performed in this pass.

Follow-up consistency: enquiry table and inspector now open the same NewFollowUpDialog used by Follow-ups, replacing the temporary generic task action. Enquiry and owner are preselected, with the shared date picker, local time, duration, notes and assignee controls. The shared editor waits for refresh, guards already-created reminders, and reports saved-but-refresh-failed truthfully. Enquiry dates no longer force Asia/Dubai. Typography now separates a stronger client name and enquiry title from quieter property labels and metadata, with medium-weight values and section headings.

The enquiry table also exposes a compact Deal column. Eligible records open the existing qualification/conversion action; converted enquiries open linked-record details, and disqualified/paused records do not offer creation. Both stage-based conversion and the table button are covered by the same endpoint/handoff regression. The live sample workspace currently has no active pipeline, so its conversion form correctly blocks saving until setup is completed.

Date fields now reuse CrmDateTimeField, combining the same shared DateField calendar as Follow-ups with a separate labelled time input. Applied to reminder creation/editing, generic CRM action dialogs (including deal dates), and inline/table stage transitions. The owner property drops its leading icon, and unscheduled active enquiries have a concise Schedule action. Verified 37 focused tests, including selecting a stage-transition date through calendar segments and preserving local time in the request.

### Deal conversion flow
A dedicated Create deal modal replaces the generic Qualify enquiry dialog. It identifies the customer, explains qualification and linked activities, collects deal name/owner/next follow-up, and keeps estimated value, currency and a date-only expected close optional. A single pipeline is selected automatically; multiple pipelines expose a selector. The starting stage is shown. Missing setup has a concrete Set up sales stages action: it rechecks GET pipelines, then POSTs a real Sales pipeline with Qualified, Proposal and Negotiation stages. Won/Lost remain deal outcomes rather than dummy stages. Setup alone never creates a deal.

Conversion still uses POST leads/:id/qualify with leadVersion, retaining backend qualification validation, transactional conversion, replay protection and activity transfer. On success the modal closes and navigates to the returned deal at opportunities?record=:id. Failed saves retain inputs; successful conversion cannot be resubmitted if navigation fails. No pipeline was silently provisioned during UI development.

Updated product decision: remove pipeline/stage setup and selection from deal creation. On saving a valid deal, reuse the active default sales pipeline (or existing active pipeline); if none exists, persist the standard Qualified/Proposal/Negotiation flow automatically through the pipelines API before conversion. The form stays compact and shows only deal information. Pipeline creation is not performed when opening or cancelling the modal. This supersedes the manual setup action above.

### Deals board refinement

The Deals page follows enquiry → Create deal → sales stages → Won/Lost. An empty workspace routes users to Enquiries, where saving the conversion provisions the standard flow; it no longer requires a separate pipeline setup screen. Existing active pipelines and direct deal creation remain supported, with the active/default pipeline preselected. Board stages use saved position, and records with missing/archived stages remain visible. Cards show the saved title, customer, value, owner and follow-up; no records or values are fabricated. Follow-up dates use the browser timezone consistently with Enquiries.

Board and list share one search, owner and status toolbar. List selection is disabled because no bulk action is provided. The list retains saved backend rows and pagination without a second filter toolbar. Data depends on GET opportunities and pipelines; direct creation and record actions retain existing backend validations. UI uses compact controls, portal tokens, visible card boundaries, and explicit empty states. Create-deal modal fields use equal columns and consistent control heights, with compact right-aligned footer actions.

Validation: focused Deals and Create-deal tests, workspace typecheck, and live desktop empty-state inspection. Populated cards are covered by fixtures; the live workspace contained no deals during inspection.

### Currency, date/time and connected sample deals

Deal creation now reads the onboarding currency from the authenticated workspace profile (`workspace.defaultCurrency`). Estimated value displays that currency; qualification and direct deal creation submit it without asking users to configure it again. Editing preserves the saved deal currency. Missing currency blocks valuation in enquiry conversion rather than inventing a default.

CRM date/time fields use shared React Aria date and time segments, replacing the native time popup. Calendar cells center their dates, expose focus states, and retain shared month navigation. Date/time columns align equally. Live verification converted both existing test enquiries into persisted deals (Daniel: AED 45,000; Amira: AED 120,000), with original customer/enquiry links, Sample Owner, and pending next-action activities. These are explicitly sample records, not hardcoded UI rows.

### Board stage movement and spacing

Open deal cards support drag/drop between active stages in the same pipeline, with highlighted drop targets and pending state. Alt+Left/Right provides a keyboard alternative; the existing details action remains available. A move reads the current record version, POSTs the existing transition endpoint, and updates the card only on success. Backend entry requirements and permissions remain authoritative; failures leave the card in place and display the error. Closed deals and cross-pipeline moves are excluded.

Removed per-column creation buttons in favour of the toolbar's New deal action. Empty columns no longer stretch to the tallest column. Shared date inputs reserve separate calendar-button space; date/time groups stack when their available width cannot fit both controls. Live drag verification moved Amira's sample deal to Proposal and confirmed its stage after refresh. Regression test covers successful movement and failed-transition preservation.
