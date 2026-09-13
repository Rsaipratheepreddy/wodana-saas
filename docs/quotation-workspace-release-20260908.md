# Quotation workspace — 8 September 2026

Live at https://iglo.wodana.ai. Release `20260908-quotation-workspace`, web build `UioFLa2fjngZimmNnf4Hh`.

The quotation workspace uses a room grid on the left and Woody chat on the right, with a draggable, keyboard-accessible divider. Preview opens from the eye button. Rooms can be selected together, added from the current Master Data, repeated with distinct names, searched, configured, reordered and removed with confirmation and undo. Changes relative to the preceding quotation version are highlighted on room cards.

Woody proposals appear in the grid without changing the saved quotation. Users can inspect variants and materials, configure suggested rooms, and confirm only selected rooms. Existing quantities and prices are preserved. A changed quotation invalidates an older proposal. New prompts read current Master Data rather than a fixed list of rooms. Unsupported references and uncertain matches remain review items; model training weights were not changed.

Base settings group title, customer details, currency, GST/VAT/tax, registration, discounts, logo, banner, inclusions, exclusions, terms, signature and payments. Uploaded images are prepared in the browser and validated as bounded image data URLs by the backend. These settings stay with the quotation and its client document. Reusable templates remain available from Templates. Existing add/variant/material configuration uses the same room modal.

Pre-execution tables use the shared DataGrid with controlled editable cells, search and column controls. Released cases explain why they are read-only; editable case tables do not inherit an unrelated CRM note permission. Authentication is memoized per server request, independent section requests run together, and notes/editor/studio/design components load only when needed. Slow section loads have an interruptible loading state. Requirement-note and scope-entry data models are unchanged in this release.

## Verification

- 180 targeted web tests and 26 commercial backend tests passed, including focused retries after two CPU-contention timeouts during a concurrent build. Type checking, targeted lint and production builds passed.
- Local, staged and live browser checks passed: multi-room selection, repeated adds, variants, materials, price editing, ten-item search, partial AI confirmation, uploaded branding/signature, preview, dark-mode accessibility, 1024/768/390px layouts and RTL divider control.
- Staged and live shared-table checks passed for measurements, inspirations, site layouts, quotations, client portal and Master Data; released-case controls remained locked.
- Real Woody request returned Living Room and Balcony with their requested linked items and prompt evidence in 20.9 seconds. No saved quotation was modified.
- Actual commercial save/reload/client projection, invalid-image rejection and stale-revision protection passed in rolled-back database transactions. All test changes were rolled back.
- Six tab switches: baseline median 1095 ms, staged 854 ms, live 881 ms. Non-notes tabs fetched requirement notes zero times, compared with seven in the baseline. These are observed samples, not a performance guarantee.
- Browser checks recorded no browser errors or server failures and confirmed saved commercial records remained unchanged.

## Deployment and recovery

- Server release: `/opt/wodana/releases/20260908-quotation-workspace`.
- Web port: `13200`; business-core port: `18140`. Intelligence remains on `18006`.
- No schema migration or dependency change. The existing Iglo testing-session policy and requirement-notebook backend code were preserved and hash-checked.
- Previous web `20260908-quotation-direct` on `13180` and core `20260908-requirement-notebook` on `18130` remain healthy for rollback.
- Rollback: `bash /opt/wodana/releases/20260908-quotation-workspace/rollback.sh` restores the previous nginx routing.
- Pre-release backup: `/var/backups/wodana/current/release-20260908T103907Z`.
- Post-release backup: `/var/backups/wodana/current/release-20260908T105703Z`.
- Scheduled backups include the release configuration and container metadata. Source/payload hashes, staging/live evidence and release record are in the server release directory. Test login tokens are not part of those artifacts.
