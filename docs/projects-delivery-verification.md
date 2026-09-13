# Commercial and Projects — local verification, 7 September 2026

Status: implemented and verified locally. This is not approval to deploy or evidence of a live payment/WhatsApp transaction.

[Projects](http://localhost:8130/workspace/projects) · [Delivery demo](http://localhost:8130/workspace/projects/b6ee0e92-bc40-44dc-a188-e2492014c43f/daily-progress) · [Client portal](http://localhost:8130/portal/iglo-architects)

## Connected behavior

Lead qualification → opportunity → Preparation → catalog-linked BOQ → quotation version → internal approval → client decision → agreement/payment milestones → release → project work plan → sourcing/orders → manufacturing/site execution → reviewed daily output → inspection/snags → handover → final account/warranty.

Planning is available before release. Manufacturing and site tasks use the same work plan. Physical completion, client publication and accounting settlement are separate decisions.

| Area | Current local implementation |
|---|---|
| Quotation entry and document builder | Table first; click a version to open its Pages rail and white document canvas. Cover, room/material tables, commercial summary, payment schedule, inclusions/terms and acceptance. The old document structure is the reference, with the current lilac/peach theme. |
| BOQ and catalogs | Preparation Included scope imports on creation; explicit refresh preserves edited rates/costs. Room/work/variant relationships, material/SKU, finishes and units load from current active catalogs. Empty rooms persist; rename preserves item identities. Catalog snapshots and source revisions stay attached. |
| Commercial controls | Immutable issued versions, revision/request closure, independent internal review, scoped client decisions, executed agreement and milestone amounts derived from the accepted schedule. Deductions create credits without duplicate positive milestones. |
| Client portal | Responsive branded login and connected review/progress/payment pages. Multiple mobile grants, viewer/approver roles and revocation live in Client access. The requested local review number now has viewer access to the delivery demo and its browser login was verified. |
| Plans and teams | Tasks/subtasks, people/owners/resources, baseline dates, dependencies, calendars, half-day leave, cross-project bookings, reschedule previews and explicit release/rebooking. Starting non-office work requires an assigned resource and confirmed booking. |
| Production | Manufacturing job cards distinguish own workshop and outside factory. Scope, drawing, materials, predecessor and capacity checks are visible. Outside-factory work requires a linked confirmed order; enquiries alone do not authorize manufacturing. Job actions open the same tasks, reports and prefilled dispatch records. |
| Daily progress | Feed opens a readable report document, not a disabled form. Author, location/shift, photos, measured work, labour hours, weather, safety, materials, blockers, next shift, review and history. Edit draft/correction is separate. Draft/save/submit/return/independent review and correction replacement prevent duplicate progress. |
| Photos and collaboration | Private UUID-addressed image/PDF uploads, retry-safe IDs, authorization checks and explicit per-file client publication/revocation. Comments/replies, edits, followers, mentions, in-app alerts and due-reminder worker. |
| Material planning | Company/vendor/client responsibility, current catalog versions, accepted stock, reservations, issues/returns/waste. Suggested new sourcing excludes accepted stock and quantities already on incoming orders. Warehouse and project transfers support approval, dispatch, receipt, rejection and retry controls. |
| Procurement | Enquiries/comparison → selected draft → budget approval → vendor confirmation → accepted/rejected receipts → close. Order detail shows linked requirement/task, next action, vendor submissions and receipts. Reviewed vendor confirmation updates the actual promised date. |
| Vendor workspace | Private branded order overview, scope/specification, dates, receipt totals and submission history. Stage-appropriate offer/availability/progress/delivery actions. Progress/delivery cannot be submitted before approval. Updates require staff review and do not independently accept deliveries or pay vendors. Supporting documents currently use references/links. |
| Site/quality/closeout | Site task execution, measured commissioning/retests, technical queries, fixed revision transmittals, independent inspections, defects/rework, area handover, warranty service and separate financial close. |
| Accounting | Project Commercial has Payments & Books using the same Pre-project milestones. Search connected QuickBooks/Zoho invoices or use an ID; verify company, exact cents, currency and balance. Duplicate invoice assignment is blocked across cases. Provider-supplied HTTPS payment links and refresh are available. Durable read-only reconciliation handles retries, stale leases, errors and reversals. |
| Release and reconciliation | New execution checks the released accepted quote, its executed agreement and fresh verified required payments. A reversed/unverified/stale required invoice blocks new execution. A reversal also reopens financial reconciliation. |
| Legacy import | Preview/hash/mapping/archived source and stable-ID import tooling exists and was verified in an isolated database. Production ownership/cutover is still an operational decision. |

## Verification

- Core: **52 tests passed**, covering commercial/project domains, invoice validation, preparation materials and execution release freshness.
- Web: **24 interaction tests passed**, including document-only report opening, explicit draft editing, catalog builder, invoice selection, financial edits and shortage calculation.
- Python: **21 tests passed** in provider and completion/reconciliation suites during this implementation pass.
- Full isolated lead → commercial → delivery → accounting-control test: **three consecutive successful runs** after the final server changes. Includes denied access, stale updates, OTP replay, vendor isolation, duplicate submissions, no pre-approval vendor progress, booking conflicts, reviewed output, selected-photo publication, partial/rejected receipts, closure and reconciliation failure/recovery. Test records are cleaned up.
- Browser audit: **58 desktop/mobile surfaces**, plus calendars, dispatch, commissioning, stock, quotation entry/builder, portal sections, dark theme and RTL; no page/console errors or document-width overflow.
- Focused browser flow: daily report document without inputs; production cards; order deep links; vendor overview → action → overview; Payments & Books. Checked at 1440 and 390 pixels.
- Quotation browser flow: real room/work/variant/material catalogs, empty room persistence, item/rate/cost editing, rename, Preparation import and refresh, payment schedule, stale-catalog rejection; 1440/768/390 pixels.
- Both TypeScript checks and an isolated optimized Next production build passed.
- Actual local portal sign-in with the user's supplied mobile and the requested demo OTP passed through the browser.

Provider reads earlier in this pass returned 31 QuickBooks invoices and zero Zoho invoices. No live invoice, bill, purchase order, payment, refund, supplier message or WhatsApp message was sent. Reconciliation tests use local mock provider responses while exercising real application transactions and the durable queue.

Reproduce from `wodana-saas/` while the local services are running and stable (the Core watcher restarts during source edits):

```sh
node services/business-core/scripts/smoke-commercial-projects.mjs
node apps/web/e2e/verify-quotation-flow-local.mjs
node apps/web/e2e/verify-project-flow-local.mjs
node apps/web/e2e/audit-delivery-local.mjs
```

## Production boundaries

1. OTP `123456` is restricted to explicitly marked local demo contacts. Real WhatsApp delivery code exists, but the actual approved sender/template and delivery receipt path still require a controlled acceptance test. Demo mode is disabled in production.
2. Accounting presently links and reconciles existing invoices. Automated project-to-provider purchase orders/vendor bills, invoice creation from project milestones, and a real payment/refund acceptance test are not signed off by these tests. Vendor settlement/credits still include controlled accounting references; they are not all automatically matched to provider bills.
3. The local API services are running; the general background worker is not started here. Deploy/monitor the worker and its internal authentication for ongoing reconciliation and due reminders. Avoid enabling unrelated outbound automations during review.
4. Confirm real company/currency/accounting connection, team membership, calendars, operating routes, approval roles, material specifications and storage/backup settings. The labelled demo has synthetic scope/approvals and intentionally no real accounting invoices; it is not a production data migration.
5. Apply the legacy preview/mapping/cutover process once, choose one authoritative owner for live records, and test recovery and revocation on the deployment environment before rollout.

Daily report structure was checked against [Procore's daily-log guide](https://support.procore.com/products/online/user-guide/project-level/daily-log/tutorials/daily-log-overview) and [Autodesk's daily-log guidance](https://help.autodesk.com/cloudhelp/ENU/BIM360D-Field-Management/files/GUID-CDBFE508-C833-42AB-9A36-A67999BBE58E.html). Company-specific sign-offs and accounting policy must come from the actual client.
