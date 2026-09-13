# Lead notes, calendar and WhatsApp validation — 7 September 2026

Release: `20260907-lead-notes-calendar`, deployed to the existing Wodana host.

## Changes

- Lead inspector now has Details and Requirement notes. The notes reuse Brief & Scope note cards and share the same persisted notes with the pre-project's Requirement notes tab.
- Legacy enquiry and qualification requirements remain available. Note updates use versions, preserve drafts on failure, reject conflicting edits, support archive/restore, and respect workspace permissions and released-case restrictions.
- Follow-ups use a Kanban view grouped by due date. Existing filters, records and scheduling editor remain in use. Moving cards does not silently reschedule records; changes happen through the existing editor.
- Calendar defaults to a weekly time grid with day/month views, date navigation, compact events and a desktop mini calendar. Overlapping and overnight events are handled without changing the underlying calendar data.
- Inbox shows a small Channel: WhatsApp label. Existing theme colors and gradients remain. Lead stage and source chips have stronger, restrained contrast, including disabled Qualified stages.
- Add default managers includes active workspace owners, administrators and sales executives, preserves existing settings and is safe to repeat.

## Production data and incoming messages

`Dubai enquiries` originated in `services/business-core/scripts/seed-iglo-release-commercial.mjs`. Its display name is now General enquiries. The existing queue ID, routing references and lead assignments are unchanged. Sixteen eligible managers were added; the existing manager was preserved, giving seventeen managers. Changes were recorded in the audit log, and the previous configuration was saved privately with the release.

Incoming WhatsApp webhooks reached the API, but the routing cache lacked the connected account's workspace mapping. The live mapping was restored. The deployed recovery code can rebuild an empty cache using existing credential references after verifying each connection against Business Core. It does not read or decrypt credential values. Unroutable webhooks return a retryable error instead of silently acknowledging dropped messages.

Messages previously acknowledged while routing was missing were not stored and were not recovered. No live customer messages or production test accounts were created for validation.

## Validation

| Check | Result |
| --- | --- |
| Production web and core builds | Passed |
| Web tests covering changed components and calendar utilities | 48 passed |
| Core CRM, conversations and pre-project tests | 104 passed |
| Python provider tests | 21 passed |
| Real isolated PostgreSQL notes/default-manager checks | 15 passed |
| Real isolated PostgreSQL WhatsApp checks | 12 passed |
| Signed webhook → cache recovery → PostgreSQL → already-open inbox | Passed, including duplicate delivery and live polling |
| Authenticated Add default managers button | Passed |
| Desktop, Windows scaling emulation, mobile and dark theme | Passed |
| Changed-file lint | Passed |
| Production public pages and login sizing | Passed at 1440, 1280 and 390 px |
| Production service health and runtime logs | All healthy; no errors found during the post-release check |

Integration checks covered legacy content, idempotent retries, concurrent edits, validation, shared notes after handoff, bidirectional updates, archive/restore, read-only roles, tenant isolation, released/archived cases, manager eligibility and settings preservation. Chat checks covered ordinary contacts without leads, inbound matching, unread state, replies, receipts and retry deduplication.

Browser testing used Chromium on macOS. Windows user agent and 125% scaling were emulated; this was not a native Windows OS test. The previous task-board source was not available in the current checkout, so the follow-up view uses the current shared components and theme.

## Deployment and rollback

- Release directory: `/opt/wodana/releases/20260907-lead-notes-calendar`.
- New ports: web 13110, Business Core 18070, intelligence API 18006.
- No database schema migration.
- Source hashes, compiled core module, Python runtime files and web build ID verified against the tested artifacts.
- Pre-release backup: `/var/backups/wodana/current/release-20260907T171415Z`.
- Post-release backup: `/var/backups/wodana/current/release-20260907T171812Z`.
- Proxy rollback: `/opt/wodana/releases/20260907-lead-notes-calendar/rollback.sh`. The prior release remains available.
- Backup configuration now includes this release.

Local development remains available at `http://localhost:8130`. Detailed logs and screenshots are retained under `/tmp/wodana-lead-notes-calendar`; temporary authenticated browser state and the isolated test database are removed after validation.
