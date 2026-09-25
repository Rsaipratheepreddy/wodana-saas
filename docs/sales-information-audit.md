# Sales information architecture audit

Based on the implemented enquiry form, enquiry workbench, lead list, intake DTO/service and qualification DTO. This is a proposed simplification, not a completed migration.

## Observed problems

- Creation mixes client identity, property/request details, source/channel attribution and assignment strategy. Manual assignment is the default and requires selecting an owner before saving.
- Mobile and Phone are separate controls; client address and property location coexist without a strong ownership distinction.
- A separate optional title, description, internal notes, requirements notes, capture-form answers and qualification answers create several places to enter similar information.
- Owner/team and source/channel repeat in Details, Source & history and the owner sidebar. Technical correlation/external-event references sit with ordinary business information.
- The enquiry workbench has Activity, Details, Source & history, Attachments and Requirements tabs, plus several independent header actions.
- The list defines many fields including separate client, reference and title columns. Some are optional columns; audit saved-view defaults before changing visibility.
- WhatsApp currently opens wa.me from the enquiry, rather than selecting a connected Inbox conversation. Opening that link is correctly not counted as a response.
- Seven persisted statuses are compressed into four visible stages: attempting contact, nurturing and paused all display as Initiated. This hides meaningful differences; preserve them as explicit statuses or secondary labels instead of silently merging them.
- Editing enquiry contact data updates the shared client identity. The UI must explain that scope and retain conflict/duplicate handling.

## Proposed ownership

| Record | Owns |
| --- | --- |
| Client | Name, contact methods, company, address, language and communication preferences |
| Enquiry | Request summary, service, project/site location, received/source evidence, owner, qualification outcome |
| Follow-up | Action, owner, due date, outcome, reminder state, linked enquiry/deal |
| Deal | Qualified sales scope, pipeline/stage, commercial value/currency, expected decision and outcome |
| Pre-execution | Detailed requirements, measurements, designs, quote versions, agreement and release evidence |

Keep an immutable original submission and audit trail. Link qualification/capture answers to their source; do not copy answers into multiple independently editable fields. Keep client address distinct from the proposed project site.

## Capture screen

One short form: choose an existing client or add a name/contact method, then service (including Not sure), request summary and optional site location. Budget/timing are optional enrichment. Show the resolved owner compactly; default routing only when configured and available, with a clear unassigned fallback. Retain attribution automatically when supplied; manual entry uses honest editable provenance, not an invented source. Do not add a new mandatory phone/email rule without handling offline enquiries and imported incomplete records.

Move company website, job position, secondary phone and client address to the client profile. Move campaign/technical references to provenance/history. Preserve existing values on edit; hiding fields must not clear them. Defaults, identity lookup and assignment resolution require API verification before shipping.

## Enquiry working screen

Header: client + short request + reference + status. One ownership/next-action strip. Three views: Overview, Conversation & activity, Files. Overview contains a concise brief and qualification checklist; original form answers are expandable evidence. Internal notes are explicitly internal within activity. Keep detailed requirements in pre-execution, carrying the original brief forward by reference.

Primary action follows state: contact/log outcome, complete qualification, create deal, or open the existing deal. Reassignment, disqualification and audit history remain available through secondary actions. Never disable progression without explaining the missing requirement.

## Enquiry list

Default proposal: Enquiry (client/request/reference combined), Service, Stage, Owner, Next action, Received. Source, budget, location and other fields remain optional columns. Views: My enquiries, All, Unassigned, Needs follow-up; exact ownership and overdue filtering must be server-supported across pagination. Search by client, contact or reference. Keep duplicate submissions in a clearly labeled review queue, not a competing enquiry list.

## Before implementation

Verify existing-client selection, contact-edit scope, routing fallback and repeated-submission behavior; map qualification requirements to existing backend transitions; connect Inbox context without counting app-opening as a response; reconcile reminder/next-action ownership. Confirm the three-view information structure before changing record layouts. No records, required fields, API contracts or stage values were removed by this audit.

## Navigation decision — latest user direction

Clients lives under Resources alongside Catalog and Materials, retaining existing routes and shared identity. Planning is a separate main destination for requirements and designs. Sales tabs are Overview, Enquiries, Deals, Follow-ups, Forms and Settings. This supersedes earlier proposals to put Clients or pre-execution in Sales. Settings uses existing assignment, response-time, field and automation screens; additional rule capabilities remain separate implementation work.
