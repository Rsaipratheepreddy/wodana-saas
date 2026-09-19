# Palm CRM health and local UAT

Local acceptance evidence for P02.5 on 18 September 2026. The acceptance run uses a fresh, disposable Palm-labelled fixture and does not deploy, invite real users, contact customers or mutate Palm Living data.

## Accepted reporting and workflow

- Enquiry health can be grouped by source, channel, owner, team, enquiry type and freshness through the shared report controls and bordered DataGrid.
- Every grouping reports the exact underlying enquiry total and exposes an explicit reconciliation result; a mismatch is visible instead of being silently presented as a valid report.
- Response SLA totals reconcile to their owner buckets. An internal note stops takeover but does not count as a customer response; a completed outbound call records explicit first-response evidence.
- The synthetic Palm path covers shared form attribution and consent, duplicate candidates, queue/team inheritance, immediate assignment notice, weekend-safe notification behavior, the 60-minute elapsed takeover, Operations and a distinct second reviewer role, qualification evidence, Opportunity conversion and Pre-execution handoff.
- Retry and replay checks preserve one logical intake, conversion and handoff. A role without report permission receives a denial.
- The real local Iglo session was re-run with automated fixture bypass disabled. Enquiry Forms and Notifications use the authenticated workspace ID and both return HTTP 200, removing the observed `Workspace not found` error.

## Verification

- `npm run test:smoke:palm-fixture` passed on a fresh migrated disposable database, including `crmHealthReportsReconciled`, `crmHealthDimensionsComplete`, `crmReportPermissionDenied`, weekend/elapsed takeover, note-vs-response, duplicate/replay and qualification-handoff assertions.
- Business Core focused run: 5 files, 34 tests passed; Business Core typecheck passed.
- Web focused run: 3 files, 8 tests passed; web typecheck and touched-file ESLint passed.
- The changed report UI contains no raw `table`, `button`, `input` or `select` elements; it composes the shared Tabs, SelectField, Button, Callout and DataGrid components.
- Targeted `git diff --check` passed before this evidence update.
- Authenticated local browser verification loaded the saved enquiry form from the real Iglo workspace after the bypass correction.

## Remaining boundaries

CRM is accepted for local synthetic use. Meta Lead Ads, PlyLeads, real email/WhatsApp/push delivery receipts, Palm clone/live migration, real Palm users, physical-device UAT and deployment remain explicit P07/P09 gates. No external provider or production readiness is claimed here.
