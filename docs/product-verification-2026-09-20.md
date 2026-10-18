# Local product verification — 20 September 2026

This is a local implementation and verification record, not a production release sign-off. No operational sample records were added and no Git operations were performed.

## Verified in this pass

- Backend project/commercial suites: 330 tests passed. Coverage includes release controls, stock and partial receipts, factory dispatch, independent review, client publication, handover, warranty, scoped permissions and revision conflicts.
- Web project/commercial/workspace suites: 270 tests passed with two workers. Legacy navigation assertions now cover the current global destinations and focused design tabs. High-concurrency quotation timeouts were resolved by bounding test concurrency, without increasing test timeouts.
- Mobile suite: 78 tests passed, including explicit receipt quantities, partial/rejected deliveries, authentication and durable report/evidence retries.
- Web and mobile TypeScript checks passed.
- Browser: existing authenticated local client portal verified for progress navigation, white document tables and unpublished-data empty states.

## Changes in this pass

- Client project milestones, work, daily updates and documents use the shared DataGrid; report/work details use the shared modal and published evidence links.
- Client Designs uses the same table component, retaining existing revision-bound decisions and verification.
- Client empty states describe shared information instead of suggesting clients create staff records.
- Native project work uses Tasks, Receiving, Daily updates and QC & handover tabs with per-project empty states.
- Native receiving no longer prefills a full delivery. Accepted quantities must be entered explicitly, are validated with rejected quantities against the outstanding amount, and require evidence. Unchanged retries retain the same request ID.

## Remaining release acceptance

- Camera/location permissions and offline/reconnect behavior on a physical mobile device. The simulator inspection timed out in this session; automated native logic tests do not replace device acceptance.
- Real provider activation and sandbox-to-live verification for configured accounting, OTP and outbound messaging/push channels. In-portal alerts do not prove external delivery.
- A live, role-separated acceptance run from a real approved BOQ through supplier/factory receiving, reviewed daily progress, client publication and signed handover. No real approvals or financial commitments were fabricated during this pass.
- Client-authored inspiration capture/upload remains to be connected to the existing design brief inspiration records; the current client portal exposes Designs and Inbox, while staff can manage inspiration in Design & Planning.

Do not describe the entire product as production complete until these checks and the remaining client capture flow are closed.
