# Settings and CRM cleanup release — 7 September 2026

Live release: `20260907-settings-crm-cleanup` on the existing Wodana host.

User Settings now contains two plain tabs, Active Sessions and Audit Logs, with simple tables. The CRM sidebar contains Overview, Leads, Follow-ups, Calendar, and Inbox. Leads keeps the existing table/board structure, manager avatars open a searchable reassignment modal, and routing order, queues, capacity, and availability are in the Auto-assignment tab. Desktop toolbar controls align at 36px; mobile touch controls and modal action buttons use 44px targets.

The release also repairs external intake retry/concurrency handling, duplicate email/phone detection and duplicate-review JSON serialization. Browser identity is forwarded when either a page or API request refreshes authentication. One existing browser session whose metadata had been overwritten with the server identity was repaired from its original history; its session and expiry were preserved. Active seed session count after repair: zero.

See [CRM capture validation](crm-capture-validation-20260907.md) for detailed evidence and source limitations. Automatic Meta Lead Ads capture is not implemented. WhatsApp/email feed Inbox, and Gmail inbound requires mailbox read scope. The new UI does not imply all external sources are connected.

## Verification

- 105 focused web tests passed; 62 CRM backend tests plus eight PostgreSQL device-limit tests passed; 37 provider/integration/worker tests passed.
- 29 live capture API/database checks and the existing full CRM smoke passed using an isolated local database and the application database role.
- Browser checks with real database records passed for owner, viewer, and restricted roles, all ten source filters, duplicate-review access, creation, avatar assignment, token refresh device identity, and mobile layout. Separate fixture checks verified settings, navigation, routing order, and capacity changes.
- Scoped lint, TypeScript, web and core production builds passed.
- Public login, admin, marketing, client portal, and API readiness returned HTTP 200 after cutover. The deployed assignment JavaScript and core intake module hashes match the verified build.

## Operations

Release directory: `/opt/wodana/releases/20260907-settings-crm-cleanup`.

Web runs on 13080, Business Core on 18040, and Intelligence API on 18003. Native nginx forwards the existing public domains to these healthy containers. Redis, object storage, and the existing background worker remain in place. Package locks and database schema are unchanged.

The source is based on the prior production release with scoped reviewed changes overlaid. Linux runtime dependencies come from the prior production images; only rebuilt application output is added. `changed-files.json` and `changed-file-sha256.json` record the source scope. `release.json` records image IDs, artifact hashes, checks, and cutover time.

Pre-release backup: `/var/backups/wodana/current/release-20260907T155240Z`. Previous containers remain available. Run the release directory's `rollback.sh` to restore the preceding nginx configuration. The metadata repair receipt and its before-state CSV are stored privately with the release. No production test account, lead, message, or invitation was created.
