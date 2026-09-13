# CRM implementation and integration readiness

Updated 7 September 2026. This status describes `wodana-saas`.

## Current CRM journey

Enquiry → duplicate-aware customer record → lead → assignment and SLA → qualification →
opportunity → won/lost/reopened → project handoff request.

The same tenant CRM APIs now serve web and mobile. Customer identity remains shared across leads,
opportunities, activities, conversations, and handoff records.

## Web CRM

| Section | Working behavior |
| --- | --- |
| Overview | Live metrics, lead-source chart, priorities, reminders, pipeline shortcuts, search, refresh, and lead creation. |
| Leads | Search/filter/table and card views, intake, assignment, status transitions, qualification, conversion, next actions, activity history, SLA, and duplicate handling. |
| Follow-ups | Due/overdue work, activity details, creation, completion, and linked-record navigation. |
| Calendar | Day/week/month views, search, local-time scheduling, appointment editing/completion, and authorized Google event display. |
| Inbox | Conversation search, threads, inbound/outbound messages, private notes, assignment, unread state, resolve/reopen, WhatsApp media, and delivery receipts. |
| People and companies | Search/filter/export, create and edit profile/contact/address/lifecycle data, relationships, consent, merge, archive, and privacy erasure controls. |
| Deals | Pipeline list, edit, stage/close/reopen actions, next commitment, stakeholders, internal team, activities, customer record, history, and handoff status. |
| Activities | Search/filter/create, complete with outcome, customer/lead/deal context, and history. |
| Sequences | Definition details, steps, publish/pause/archive controls, enrolments, and run state. |
| Automations | Visual workflow editor, validation, dry run, publish/pause, run history, and approval decisions. |
| Reports | Source, pipeline, funnel, SLA, assignment, and forecast reports with a selectable date range, search, filters, and export. |

The simplified CRM sidebar shows Overview, Leads, Follow-ups, Calendar, and Inbox. Customers & sales, Automation, and Insights are removed from the sidebar. Existing record routes remain available for linked workflows. Leads contains All leads and Auto-assignment tabs, and clicking a lead manager avatar opens reassignment.

See `crm-capture-validation-20260907.md` for the current source-by-source validation and production limitations.

## Mobile CRM

The CRM card on mobile opens a native CRM workspace instead of a placeholder. It includes:

- **Today:** tenant metrics and the top eight customer priorities, with an explicit option to show the full queue.
- **Leads:** search, status filters, manual lead intake, lead detail, status transitions, and quick follow-up creation.
- **Deals:** search, filters, deal creation, detail, close, loss, and reopen controls.
- **Inbox:** conversation search/filter, thread history, custom email and in-window WhatsApp replies,
  approved WhatsApp templates outside the service window, internal notes, and resolve/reopen.
- **More:** grouped people, companies, activities, actionable 30-day calendar, sequences, automations, approvals, and six date-filtered reports.

Mobile screens include loading, error, empty, validation, refresh, touch, and accessibility states.
Customer phone actions open the native dialer from people, lead, deal, activity, and conversation views.
CRM and HRMS use a neutral portal canvas with the Wodana lilac-rose-peach gradient reserved for
selected tabs and primary actions. CRM date/time actions use native pickers.
The content is capped to a readable tablet width while remaining full width on phones, and changing
tabs returns to the top of the selected section.

## Connected providers and boundaries

- **Google:** connected locally. Gmail send was verified. Gmail inbound needs one reconnect to add
  the read-only mailbox scope. Google Calendar events can be read when selected; automatic two-way
  CRM appointment synchronization is not implemented.
- **WhatsApp Business:** connected locally. Outbound sending, inbound messages/media, and delivery
  states reach the CRM inbox. Custom text is available for 24 hours after the customer's latest
  message; outside that window the web and mobile composers switch to an approved tenant template.
  The local demo uses a verified temporary HTTPS webhook; production still needs the permanent
  public callback and Meta review/configuration.
- **QuickBooks Online:** sandbox connection and authenticated reads are verified in Integration Hub.
  Invoice/payment-link placement inside CRM, pre-project, project, and finance records is planned in
  `docs/meta-leads-and-accounting-plan.md` and has not been implemented.
- **Zoho Books:** authenticated connection and reads are verified in Integration Hub. Record-level
  accounting placement and reconciliation are planned with the QuickBooks work.
- **Meta Lead Ads:** the tenant Page/form ingestion design is complete. Implementation is deferred
  until after the CRM usability work and remains required before Facebook or Instagram form leads
  can be claimed as automatic.

Each tenant connects its own provider accounts under **Workspace → Integrations**. Credentials and
tokens remain server-side and are scoped to the workspace and legal entity.

## Verification

- Web CRM: 83 focused component, route, and client tests pass across 12 files; TypeScript passes.
- Business Core CRM: 62 tests pass across five files.
- Mobile: 33 tests pass, including the browser CRM proxy boundary; TypeScript passes.
- Targeted web lint passes after the final CRM changes.
- Eight CRM browser journeys pass on desktop and mobile viewports, covering overview layout,
  conversation notes/replies, failure handling, themes, and Woddy.
- Browser checks verified the populated web overview, customer table, report date controls, sidebar,
  mobile Today, Leads, and More views against the local Iglo tenant data. Native iPhone checks also
  verified the CRM/HRMS gradient tabs and the customer call control.

These results establish a stable local implementation. Production rollout still requires live-role
acceptance, public provider webhooks, operational monitoring, and the deferred Meta Leads and
accounting record wiring.
