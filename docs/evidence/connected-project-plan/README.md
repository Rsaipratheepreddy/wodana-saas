# P08.2 connected project plan — local acceptance

Verified locally on 18 September 2026. No Palm tenant, client data, provider, invitation or deployment was changed.

## What is connected

- Every active released package carries an accountable owner, priority, risk, planned start/end, next action, action owner/date and recovery plan. New packages receive safe planning defaults; historical packages are normalized without rewriting their released scope lineage.
- Package dependencies are explicit and also derive from linked task predecessors. Unknown, duplicate, self-referencing and cyclic dependencies are rejected rather than producing an ambiguous schedule.
- Supplier commitments join the linked task and expose order state, promised date and lead time. A supplier promise after linked work starts is a visible delivery issue.
- Factory, crew and vendor capacity joins the existing resource-booking model. Active field work without a confirmed booking remains an explicit issue.
- Project promise, target completion and handover stay visible beside the package plan. A package forecast beyond the client target requires a recorded recovery plan before it can be committed as ready.
- Package readiness now checks schedule, next action, dependencies and recovery alongside the existing released-scope, design, material, owner and route evidence.

## HRMS privacy boundary

The existing booking-confirmation path checks resource capacity, HRMS calendars and approved leave. The connected-plan projection consumes only the confirmed aggregate booking and resource name/kind. It does not expose employee membership IDs, leave, calendar entries or supplier contact details. Dedicated tests serialize the response and assert those private fields are absent.

## Product UI

The project Schedule area now includes a single bordered shared `DataGrid` for packages, accountability, dates/dependencies, supplier/capacity commitments, next action and risk. Editing uses the existing shared form, input, select, multi-select and dialog primitives. The new connected-plan component contains no raw `table`, `button`, `input`, `select` or `dialog` markup.

## Automated verification

- Focused Business Core planning/package matrix: 4 files, 41 tests passed; final connected-plan matrix: 4 files, 16 tests passed.
- Full Business Core regression: 128 files passed, 1 skipped; 767 tests passed, 10 skipped.
- Focused web project/connected-plan matrix: 2 files, 16 tests passed.
- Full web regression: 146 files, 686 tests passed in the bounded serial run. Parallel runs exposed timing-only five-second timeouts in unrelated catalogue/quotation/CRM tests; the catalogue test and the new project tests passed independently.
- Business Core and web TypeScript checks passed. Changed web ESLint passed.
- New connected-plan raw-control scan and `git diff --check` passed.

## Remaining boundary

P08.2 provides plan and capacity truth; it does not invent a factory optimization engine or copy private HRMS records into Projects. Purchase-order receiving, production/dispatch/site receipt, installed-quantity variance and native receipt/photo actions belong to P08.3. Physical-device, provider and Palm clone/live acceptance remain P09 gates.
