# P05.1 per-room design deliverables

Date: 2026-09-18  
Boundary: local source, synthetic tests and a disposable PostgreSQL database only. No Palm Living data, provider connection, invitation or deployment was changed.

## Accepted behavior

- The existing design library covers moodboards, space plans, renders, material/finish boards and specifications, and the technical drawing taxonomy. Every file is organized under a room, requirement item, or room + item folder and keeps that source context on the design record.
- Each uploaded file has immutable numbered revisions. A revision returns its author, created time, status, note, exact asset, assigned reviewer and optional included client-review allowance. Earlier revisions and their evidence remain available after a new draft is uploaded.
- The file-detail view now exposes design type, revision and author, room/item source, client-review usage and the revision note together, rather than requiring users to infer those facts from separate screens.
- An included client-review allowance is optional because no universal Palm or product default has been confirmed. `NULL` means “not configured”; zero is a valid explicit allowance. Values are constrained to 0–99.
- The allowance is pinned on the revision. New revisions inherit the previous value unless the request explicitly changes or clears it. A draft allowance can be edited; after review begins, the same immutable-review guard used for room, item and design type applies.
- Actual client rounds are counted from distinct revisions explicitly sent to client review. Usage is shown as `used of included`; over-allowance is visible but does not silently block work. Enforcement and exception/fee policy remain a product/commercial decision for P05.4.
- Upload and edit flows compose the shared `NumericInput`, `TextAreaField`, `SelectField`, `Button` and modal shell. This slice removed the two touched ad-hoc textareas instead of adding new feature controls.

## Migration proof

Migration `0092_design_round_policy.sql` was applied with the complete migration history to a newly created disposable PostgreSQL database.

- `included_client_rounds` exists on `pre_project_design_versions`.
- `pre_project_design_versions_client_rounds_check` was present after migration.
- The disposable database was dropped after inspection.

## Acceptance matrix

| Case | Evidence |
| --- | --- |
| Deliverable taxonomy | Existing backend and web document types include concept/mood board, material/finish, space plan, render, presentation and technical drawings. |
| Room/item source | Existing folder validation requires a room, item, or both; file detail tests verify the returned room and item are displayed. |
| Revision author and status | The version projection returns author and state; detail tests verify `R1 · Designer` and the existing workflow suite covers every state. |
| Included-round policy | DTO tests cover optional/null and out-of-range values; service tests cover explicit change/clear and inherited persistence on a new revision. |
| Actual round usage | The service counts distinct revisions sent with `client_review`; UI tests cover `3 of 2 used · over allowance`. |
| Shared components | The touched upload/edit fields use design-system number, textarea, select, button and modal components. |

## Verification results

- Focused Business Core design acceptance: 1 file / 30 tests passed.
- Focused web design acceptance: 2 files / 34 tests passed.
- Full Business Core regression: 122 files passed, 1 intentionally skipped; 722 tests passed, 10 skipped.
- Full web regression, serial: 142 files / 672 tests passed.
- Business Core and web typechecks passed.
- ESLint passed for the changed P05.1 web files.
- Fresh disposable migration through `0092` passed.
- `git diff --check` passed before this evidence record was added.

## Release boundary

This slice makes deliverable truth and allowance usage explicit; it does not invent Palm Living’s contracted number of included rounds, an overage fee, an override authority, or a hard-stop policy. Those must be confirmed before P05.4 can claim round-limit enforcement. P05.2 remains responsible for side-by-side comparison, pinned revision feedback and a complete client decision request. No live release or Palm Living UAT is claimed.
