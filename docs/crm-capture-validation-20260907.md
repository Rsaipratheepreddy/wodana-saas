# CRM capture and visibility validation — 7 September 2026

The capture API and existing CRM workflows were exercised against a disposable local database using the application database role, including row-level tenant isolation. Provider adapter tests use simulated provider traffic. Production inspection was read-only; no verification leads, messages, invitations, or accounts were created there.

## Supported paths and remaining gaps

| Source/path | Verified behavior | Production limitation |
| --- | --- | --- |
| Manual, website, Instagram, referral, repeat customer, developer labels | Manual entry creates an enquiry and lead; the source and channel survive listing and filtering. | Selecting a source label does not connect an external account or form. |
| Form, import, API, webhook, automated intake methods | Authenticated intake creates a queryable lead and retains attribution. Replays return the original record. | No general public website form endpoint or automatic import connector is configured by these API methods alone. |
| WhatsApp | Verified webhook handling and deduplication feed customer conversations and Inbox messages. The public production callback is reachable and rejects an invalid verification request. | Incoming messages do not automatically create Leads. Production has WhatsApp conversations without linked leads; Meta subscription delivery was not retested with a real customer message. |
| Gmail | The inbound adapter feeds Inbox conversations when mailbox read access is available. | The production connection has Gmail send scope, but no Gmail read scope. Reconnection with read access is required for inbound sync. Inbox messages do not automatically create Leads. |
| Facebook / Instagram Lead Ads | No automatic connector is implemented. | Page/form authorization, lead retrieval, mapping, and webhook ingestion remain unimplemented. |

Production has a queue member but no assignment policy or published assignment automation. Manual UI auto-assignment can use the fallback queue; automatic external intake assignment is not established by that configuration alone. No provider messages were sent during verification.

## Corrections from validation

- External event replay and simultaneous provider retries previously raised a PostgreSQL uniqueness error and returned HTTP 500. Intake now uses conflict-safe insertion, reads the committed original event, and rejects changed content with HTTP 409.
- Matching unverified email/phone contacts were missed when the submitted name differed. Such matches now require duplicate review; verified contacts retain automatic customer reuse.
- Duplicate candidate reasons were passed as a PostgreSQL array into a JSON column, causing HTTP 500. They now serialize as JSON; review and attachment to the existing customer were exercised successfully.
- Web session refresh omitted browser metadata and relabeled a real browser session as `node` on the server. Both page and API refresh paths now forward browser metadata. This was a display metadata problem, not an extra device session.

## Visibility and assignment

An active member with `crm.leads.view` can see all leads in their workspace, including assigned and unassigned leads. Visibility is workspace-wide, not limited to the assignee. Lead mutation requires `crm.leads.manage`; routing configuration mutation requires `crm.settings.manage`. Restricted roles receive HTTP 403. Outsiders and cross-workspace record access receive HTTP 404. Source filtering and paginated listing retain the records.

The web initially loads 100 leads; its explicit **Load more leads** control adds older records to both views and local search/filtering. Source options reflect the loaded records. The tests verify API pagination without gaps or duplicate IDs.

## Evidence and reproduction

- `services/business-core/scripts/smoke-crm-capture.mjs`: 29 passing live API/database checks covering ten source/method combinations, replay/concurrency, email/phone/name duplicates, resolution, attribution, malformed input, assignment capacity, stale versions, permissions, pagination, and Inbox behavior.
- Existing `smoke-crm.mjs`: passes the full CRM lifecycle, assignment, activities, conversations, conversion, reporting, automation replay, and simulated notification receipts.
- 105 web tests, 62 CRM backend unit tests, and 37 provider/integration/worker tests pass. Session refresh has two dedicated regression tests within the web total. Scoped lint, TypeScript, and production builds pass.
- Desktop/mobile browser checks cover the simplified CRM/settings screens. A separate browser run uses real database-backed capture records and password authentication, including source filters and restricted-role visibility.

Run the capture checks only against an isolated local API/database:

```sh
CRM_CAPTURE_TEST_ISOLATED=true BUSINESS_CORE_URL=http://127.0.0.1:8144/api/v1 node services/business-core/scripts/smoke-crm-capture.mjs
```

The isolated API uses development actor headers and a test internal token. Redis and mail delivery are disabled. The script intentionally refuses remote endpoints and requires explicit isolation opt-in. Its generated records belong only in the disposable database; remove that database after verification.
