# Quotation workspace correction — 9 September 2026

## Experience

- Restored a compact editable quotation header: title, client, location and validity date. Branding, tax, currency and remaining settings stay available through Base settings.
- Restored the Woody AI assistant beside manual editing, with room-specific context. On mobile both sections remain available, with a shortcut to the assistant.
- Dark column headings, lavender room headers and teal material sections distinguish the table hierarchy. Editable cells have visible boundaries; totals remain calculated.
- Each item's materials start collapsed. Expand only the breakdown needed; a material search can reveal matching rows. The summary explains whether materials set the item rate or are reference-only.
- Text edits update the draft immediately so Save is enabled while typing. Undo groups each focused edit, and Escape restores the previous value and catalog/pricing metadata.
- Item rates can be overridden directly. Changing material prices recalculates the item only when material-based pricing is selected. Client-supplied material prices remain editable but are not charged.
- AI suggestions require explicit review before insertion. Existing rooms accept missing items without replacing manual lines, quantities, prices or notes. Repeated suggestions are skipped. New suggested items start at quantity 1 and rate 0 for user confirmation.
- AI failure and cancellation leave manual work intact. No customer records or paid AI requests were used for testing.

## Validation

- Web typecheck passed; lint has no errors (one pre-existing inline-image warning for uploaded photo previews).
- 45 frontend tests passed for the workspace, existing builder/settings, commercial page, material pricing, AI merging and assistant API.
- 18 backend pricing and commercial-domain tests passed.
- Four browser workflows passed across desktop and mobile, covering collapsed materials, editing, catalog rows, photos, saved/reopened drafts, pricing, preview, AI failure/retry, explicit review, duplicate prevention and preservation of manual prices.
- Desktop/mobile screenshots reviewed; page horizontal overflow checked. Synthetic browser fixtures remain excluded from production builds.

## Deployment

Target: existing VPS, release `20260909-quotation-workspace`, web port 13310.
Previous release: `20260909-design-workspace`. Existing core on port 18190 is preserved; no database migration.
The automated script creates backups and a rollback command before switching traffic.
Status: live. Backup and proxy cutover completed successfully; the new web container is healthy.

Post-deployment verification:

- Public `/login` returns 200 and release header `20260909-quotation-workspace`.
- Public API readiness reports PostgreSQL healthy.
- Published quotation JavaScript contains the restored header, AI assistant, review dialog, material accordion and pricing controls.
- `/testing/quotation` returns 404 in production.
- Authenticated browser workflows were verified locally with synthetic data; no live customer quotation was modified for verification.
