# P03.2 — room-first requirements evidence

## Accepted local boundary — 18 September 2026

The requirements workspace now makes discovery completeness visible at the point of capture without creating another editable source of truth.

### Workflow implemented

- Requirements remain room-first, with whole-project entries supported when a room is not yet known.
- The guided capture uses plain **Need**, **Want**, **Optional**, **Constraints / avoid** and **Consultant review** language while retaining the existing API enum values.
- Client requirements submitted through the published shared enquiry form arrive as client-originated drafts. Linking one into Preparation preserves client provenance and the consultant review state.
- The screen derives four compact indicators from current records: rooms covered, client drafts awaiting consultant review, open scope decisions and included items without a verified measurement.
- Uncovered room names are shown directly on the Requirements screen.
- Existing inspiration uploads and non-destructive photo annotation remain attached to the same requirement records.
- Existing definition publication and purpose-bound client-portal OTP decisions remain the immutable confirmation boundary. A changed source hash cannot be confirmed as the earlier version.

### Data and safety rules

- Coverage is derived from rooms, active requirement entries and current site-measurement status; users cannot edit the summary directly.
- Archived requirements and non-requirement references do not count as room coverage.
- Only `verified` site measurements satisfy the measurement indicator; measured, incomplete and recheck states remain visible gaps.
- Public enquiry requirements become client drafts in the authenticated consultant workspace. No anonymous Preparation mutation endpoint was added.
- Existing tenant permissions, RLS, case status and definition version rules are unchanged.

### Verification

- Discovery coverage domain tests: 3/3 passed.
- Requirements/editor component tests: 25/25 passed across the focused files.
- Full Business Core suite: 116 files passed, 1 skipped; 689 tests passed, 10 skipped.
- Full web suite: 137 files passed; 653 tests passed.
- Business Core and web TypeScript checks: passed.
- Pre-execution Playwright navigation: 6/6 desktop and 6/6 mobile passed, including coverage assertions.
- Headless visual inspection: Requirements reviewed at 2560×1440 and 390×844 with no overflow or clipped actions.

No Palm/live data, deployment, production migration or external provider was touched. Offline native field capture, resumable media and real-device evidence remain P03.3–P03.4 and P09 work.
