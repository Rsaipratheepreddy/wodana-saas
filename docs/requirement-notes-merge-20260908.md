# Unified requirement notes — 8 September 2026

Requirements now opens one notebook. The old Notes / Scope items toggle is removed. Existing CRM notes and existing case requirements appear in the same searchable list. Each selected note has room and Master Data item choices, with additional scope details and access to materials and measurements. New notes are created inline; cases without a linked CRM lead remain supported.

Case requirements retain their IDs and existing design, measurement, asset and quotation connections. Rich documents and pins are stored on the existing records. Shared CRM notes can link to a case requirement; the note and scope save in one transaction. Linked records appear once in the notebook. Stale edits, invalid asset/room references, and writes to released cases are rejected. The editor uses one scrolling document area, including its room details.

## Release requirement

This change is local and has not been deployed. Apply `services/business-core/drizzle/0050_requirement_note_documents.sql` before starting the updated backend. The migration adds nullable document JSON and a pin flag; it does not replace or delete records. Only the isolated local QA database was migrated during verification.

## Verification

- Web production build and backend build pass.
- Web/backend type checks and targeted web lint pass.
- Backend suite: 288 passed, 10 previously skipped.
- Web suite with two workers: 464 passed; one existing Leads filter test exceeded its default five-second limit. Its isolated retry with a fifteen-second budget passed in about 5.5 seconds. No test source or timeout configuration was changed for that retry.
- Requirement editor regression tests: 21 passed after the final editor changes.
- Eight additional backend regression tests cover document preservation, attachment ownership, retry safety, archival guards, and related Master Data choices.
- Fourteen local API checks cover rich documents, scope identity, measurements, retries, transactional linked-note saves, ownership and released-case locks. Additional live checks cover private image upload/preview and capture without a CRM lead.
- Browser checks cover the single list, inline creation, room selection, save/reload, materials dialog, mobile navigation, horizontal overflow and browser errors.

Local QA logs and screenshots are in `/tmp/wodana-requirements-merge-20260908/`. Production data and deployment were not changed.
