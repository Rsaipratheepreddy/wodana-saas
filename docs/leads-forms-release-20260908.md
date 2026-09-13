# Leads and enquiry forms — 8 September 2026

Release `20260908-leads-forms`, web build `gx0cYMK-JrY04i-JYEY9j`. Live at https://iglo.wodana.ai. Staging and live verification passed.

## Included

Automatic workspace enquiry references, enquiry types and structured customer details; controlled source/channel choices; assignment during creation; duplicate handling; editable Google Forms-style enquiry forms with drafts, publishing, pausing, public links, QR codes and readable responses; lead-flow reports and shared tables. The portal theme is retained with neutral form cards.

## Existing records

The user chose the recommended reshape approach. Keep accounts, Master Data, integrations and linked work. Five existing enquiries receive references; their original timestamps and other fields are preserved. Two legacy source/channel pairs are normalized: Instagram/phone becomes Company/Instagram; website/internal becomes Company/Website. The intake records receive the same canonical classification. Original payloads, historical attribution and classification provenance remain available, with an audit entry for each normalization. No new business samples are added to production. Three linked pre-execution/commercial cases are preserved.

Migration `0049_lead_enquiry_flow` is additive. Its first database-copy check caught the existing timestamp trigger updating old enquiry timestamps; the migration was corrected to suspend only that trigger during the reference backfill and re-enable it in the same transaction. The corrected migration passed. Production was untouched by the failed rehearsal.

## Verification

- 465 web tests and 280 core tests passed; 10 existing core tests skipped. Production builds, type checks and targeted lint passed.
- 28 local API workflow checks and 5 database checks passed, covering reference allocation, retries, duplicates, permissions, RLS, assignment, form publication and submission, responses and reporting.
- A production database backup was restored into an isolated staging database. Reference backfill and source normalization passed, preserving eight protected tables and existing timestamps, original intake payloads, lead ownership and linked work.
- Staged browser verification passed: create a lead, add and reorder questions, required choices, draft save, preview, publishing, QR, anonymous 390px submission, linked response and reports. No browser errors. Staging outbox dispatch and intelligence calls were disabled.
- Staging fixtures stayed in the isolated database and were never copied to production. The temporary server staging database was removed after live verification.
- Eight staged-production and eight live checks passed: references, canonical source/type values, report reconciliation, empty production forms, creation form, Forms/Options/Reports/Auto-assignment tabs, mobile layout, existing quotation preview and unauthenticated access. No browser/server errors or data mutations were observed.
- Public login checks returned HTTP 200 with the new release header on iglo.wodana.ai, wodana.ai, client.wodana.ai and admin.wodana.ai.

## Release and recovery

Server directory: `/opt/wodana/releases/20260908-leads-forms`. New web/core ports: `13210` / `18150`. Previous public web/core remain available at `13200` / `18140`.

The active intelligence API and background worker now point to the new core. An authenticated read from the worker to the new core also passed. Their existing images and credentials are preserved; their previous compose configurations are included in rollback.

Rollback script: `/opt/wodana/releases/20260908-leads-forms/rollback.sh`. Restores previous public routing and worker/API configuration. Additive schema and source normalization remain compatible with the preceding application. Do not restore a whole older database over later user changes.

Artifact hashes, backup paths, migration/reshape logs and staged/live verification evidence are held in the release directory. Private credentials and test tokens are excluded from source and payload archives.

## Remaining product work

Connecting WhatsApp or Gmail brings messages into Inbox. Automatic creation/linking of Leads from those Inbox messages is not implemented in this release. Other outstanding Palm Living decisions include location-based routing/reporting, configurable stale thresholds (currently seven days), approved customer types, PlyLeads ownership, lifecycle/conversion rules, campaign design, duplicate policy decisions and KPI targets. Budget and project description remain optional because the reference document is inconsistent on their required status.

Pre-cutover backup: `/var/backups/wodana/current/release-20260908T123326Z`.
Post-release backup: `/var/backups/wodana/current/release-20260908T124238Z`; checksums verified.
