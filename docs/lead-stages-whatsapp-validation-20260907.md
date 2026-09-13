# Leads, WhatsApp and company cards — 7 September 2026

**Live and verified:** `20260907-leads-whatsapp`. The release keeps the existing workspace palette, gradients and avatar styling.

## Behavior

- Leads expose **New, Initiated, Qualified, DisQualified**. Existing Contacting, Connected, Follow-up and Paused records are displayed under Initiated without deleting their history or rewriting persisted statuses.
- A Qualified lead appears immediately in the Pre-project table. Starting it creates a linked case and opportunity only when required. Existing cases replace the incoming lead row. Reopening or disqualifying an unconverted lead removes its incoming row; converted leads retain their linked case.
- The start dialog asks for an active lead manager and next follow-up. It preserves customer/enquiry history and does not invent a budget, mark a deal won, or release a project.
- Inbox shows WhatsApp chats for both leads and ordinary contacts. Internal notes, other-channel selectors, template controls and campaigns are removed from this view. Existing records remain in the database.
- Incoming messages refresh automatically. Manual chats reuse the contact's existing thread; the next provider message joins a matching manual thread. Replies keep their draft after failures and reuse a request identity on retry. Provider receipts drive delivery/read state.
- Company profile cards have equal heights in the desktop grid. Mobile cards stack and size to their content without clipping.

## Validation

- **144 web tests passed**, including the affected CRM workflows, stage changes, Pre-project routes/table, WhatsApp composer and company profile. The final correction to the screen assertion was rerun with the inbox suite: 20/20 passed.
- **72 core CRM and Pre-project tests passed.**
- **22 isolated PostgreSQL/API stage checks passed:** immediate visibility, search/filtering, old stage values, no automatic case creation, reopening/disqualification, reason/follow-up validation, stale versions, cross-workspace ownership, permissions, missing pipelines, rollback on entry requirements, pagination, eight concurrent starts, retries and archived case deduplication.
- **12 isolated WhatsApp checks passed:** ordinary contacts without leads, concurrent inbound deduplication, existing/manual-thread reuse, phone search, hidden internal notes, unread/resolved behavior, idempotent reply retries, conflicting replay rejection, provider receipts, reply-window expiry and permission-scoped connection state.
- **30 isolated lead-capture checks passed** across the supported intake paths, replay/duplicate handling, attribution, assignment capacity and workspace visibility.
- Browser checks passed in Chromium at 1440px, 1280px with a Windows user agent and 125% device scaling, and 390px mobile. Both light/dark views were checked. Company card heights were 252px each at 1440px and 271px each at 1280px. This was Windows-style emulation on macOS, not a native Windows test.
- Web/core production builds, TypeScript and web lint passed. Source and payload checksums are verified during deployment.

## Boundaries

WhatsApp custom replies remain subject to Meta's customer-service window. The composer explains when the contact must message again. The platform rule is described in [Meta's WhatsApp documentation](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/). Templates and campaigns remain outside this inbox.

Messaging checks used an isolated local database with no delivery worker or real provider credentials. No production customer test messages or accounts were created. Existing source-connector limitations documented in `crm-capture-validation-20260907.md` remain; source labels alone do not establish live connectors.

## Operations

- Local app remains available on `http://localhost:8130` with core on port 8131.
- Deployment uses the previous release's matching Linux runtime dependencies; no dependency or schema migration is required.
- Pre-release backup: `/var/backups/wodana/current/release-20260907T164114Z`, with 25 checksums verified.
- Production release metadata and rollback command are in `/opt/wodana/releases/20260907-leads-whatsapp/release.json` and `rollback.sh`.

- Post-release backup: `/var/backups/wodana/current/release-20260907T164542Z`, with 27 checksums verified.
- Public tenant/admin/login/client pages and API health returned 200. Published WhatsApp/stage bundles match tested artifact hashes; public login passed at 1440px, 1280px and 390px with 44px fields/buttons and no browser errors.
- Isolated QA database, temporary login state and local dump removed. The normal local app/core remain running.
