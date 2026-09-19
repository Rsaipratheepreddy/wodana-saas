# P08.4 field pulse and quality — local acceptance

Verified locally on 18 September 2026. No Palm tenant, provider, client invitation or deployment was changed.

## One project truth

- Native field actions map into the canonical project execution commands; there is no second report or snag store.
- A daily update is saved as a draft before evidence upload, then submitted for independent review. Stable request, report and photo IDs make interrupted retries idempotent.
- Completed quantity remains proposed until project review. The report also carries issues, schedule impact, recovery plan, next-update owner/date and evidence.
- Snags retain task/area, severity, accountable owner, due date, evidence and status. The assignee submits a correction; a different permitted reviewer verifies closure. Reopening is explicit.
- The mobile projection is assignment-scoped and excludes supplier contacts, costs, budgets, margin, employee calendars/leave and client-portal notes.

## Offline and conflict behavior

- Pending reports, snags and snag-status updates are isolated by signed-in user and workspace in durable local storage.
- Camera files are copied into app-owned document storage before sync and capped at 10 MB each.
- Sync checkpoints the draft command, every acknowledged photo, and final report submission. It resumes after interruption without replaying acknowledged evidence.
- Network loss remains retryable. Revision conflicts, permission changes and invalid records stop for visible review rather than overwriting server truth.
- “Review latest and retry” is an explicit rebase against the newest project revision; it is never a silent merge.

## Client-safe curation

- Reports stay internal through draft, submitted and approved states.
- Only a reviewer can publish an approved, non-superseded report, and only selected report-owned evidence files are exposed.
- Required inspections must be complete before publication. Unpublish removes client visibility without deleting the internal audited record.
- The public projection contains only published reports and selected files; internal blockers, safety notes, commercial data and ordinary construction snags remain private.

## Focused verification

- Business Core project field/domain/file matrix: 3 files, 35 tests passed.
- Business Core TypeScript check passed.
- Native app logic suite: 63 tests passed, including draft/media/submit checkpoints, interruption resume, identity isolation and conflict classification.
- Native app TypeScript check passed.

## Honest boundary

This is local engineering acceptance. Full cross-module/browser/device acceptance remains P08.6/P09 as requested. App-store signing, physical-device camera/offline/reconnect testing, Palm clone/live data and deployment were not performed.

