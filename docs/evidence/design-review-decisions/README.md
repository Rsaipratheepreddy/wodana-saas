# P05.2 revision review and client decisions

Date: 2026-09-18  
Boundary: local source, synthetic tests and disposable PostgreSQL only. No Palm Living data, contact, invitation, provider connection or deployment was changed.

## Accepted behavior

- Staff can open any retained revision and compare it side by side with another revision of the same deliverable. Each panel identifies the revision, author, workflow state, exact file and revision note. PDF and image previews use the existing authenticated asset paths.
- Feedback is stored against an explicit `versionId`, filtered to that revision and now labelled `Pinned to R#` in the file view. A comment on an earlier revision cannot be mistaken for feedback on the latest file.
- Internal review remains assigned and permissioned. The selected reviewer approves or requests changes against the latest revision only; earlier versions are read-only history.
- Client publication remains explicit: only a latest, internally approved revision can move to `client_review`, and only when the client portal is enabled with an active approver.
- Client decisions now have three distinct outcomes: approve, request changes, or reject. Requesting changes and rejection both require a reason, but persist as different states (`changes_requested` and `rejected`).
- A client decision is bound to the case, exact design revision, outcome and OTP challenge purpose. Only the designated approver can decide; replays are idempotent only when the recorded revision, outcome, note and client grant are identical.
- Explicitly published revisions remain visible and downloadable in the client portal after approval, a change request or rejection. Draft and internal-only revisions remain excluded.
- The staff compare and comment UI composes the existing Button, SelectField, TextAreaField, Checkbox, modal and preview components. The touched design forms contain no raw button, input, select, table, dialog or textarea controls.

## Migration proof

Migration `0093_design_rejection.sql` was applied with the complete migration history to a newly created disposable PostgreSQL database.

- The design-version status check includes `rejected` alongside the existing controlled states.
- The P05.1 round-policy constraint remains present after the new migration.
- The disposable database was dropped after inspection.

## Acceptance matrix

| Case | Evidence |
| --- | --- |
| Side-by-side revision comparison | Staff UI test opens the comparison view and asserts both exact revision regions and notes. |
| Revision-pinned feedback | Design service requires a real version ID; comments are filtered and UI-tested with `Pinned to R2`. |
| Internal review boundary | Existing design workflow tests cover assigned reviewer, permission and latest-revision guards. |
| Explicit publish | Existing portal-readiness tests require enabled portal + active approver; client query exposes only explicit client states. |
| Approve / revise / reject | Portal approval tests verify distinct `approved`, `changes_requested` and `rejected` writes and required reasons. |
| Purpose-bound verification | Purpose parser and portal UI tests bind case + revision + exact outcome; the action includes the same challenge ID and code. |
| Replay and permission safety | Backend tests cover viewer denial, stale status denial, invalid OTP with no mutation, exact replay and conflicting replay. |

## Verification results

- Focused Business Core review acceptance: 3 files / 49 tests passed.
- Focused web review acceptance: 3 files / 41 tests passed.
- Full Business Core regression: 122 files passed, 1 intentionally skipped; 726 tests passed, 10 skipped.
- Full web regression, serial: 142 files / 674 tests passed.
- Business Core and web typechecks passed.
- ESLint passed without errors for the changed P05.2 web files.
- Fresh disposable migrations through `0093` passed and the resulting status constraint contains `rejected`.
- Touched design feature files contain no raw button, input, select, table, dialog or textarea controls.
- `git diff --check` passed before this evidence record was added.

## Release boundary

P05.2 does not claim spatial canvas pins; “pinned feedback” means immutable revision-bound feedback, which is the evidence contract currently supported by the backend. It also does not yet carry the approved revision into quotation, production or project packages; that is P05.3. Expiry and supersession acceptance remain P05.4. No live release or Palm Living UAT is claimed.
