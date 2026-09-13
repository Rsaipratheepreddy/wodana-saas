# Design workspace cleanup — 9 September 2026

## Experience

- Designs is the complete folder-based library, not a draft-only queue. Files and folder counts remain stable as approvals change.
- Internal approval contains submitted revisions and internally approved files ready for client handoff. Client approval contains files waiting for the portal decision. Approved contains latest client-approved revisions.
- Approval queues use compact rows with folder context, design type, revision, status and reviewer. The library retains folder/file cards.
- Search finds files and notes across folders, including empty matching folders. Archived files remain discoverable and can be restored.
- Opening a file replaces the workflow tabs with a compact file workspace. Back returns to the originating folder or queue.
- Preview and comments sit together. Details editing is a short folder/type/note form. New revisions preserve earlier files and decisions.
- Approval, rejection, upload and portal updates do not close the open file or change the selected queue.
- Comments include review decisions and preserve legacy messages without thread/blocker UI.
- Background refresh does not overwrite newer local saves. Unsent comments are retained after failures and guarded when leaving the file or changing revisions.
- Portal handoff requires enabled client access and an active approver, checked again on the server. The dialog explains that publishing does not send a notification.

## Validation

- 34 frontend design and client-portal tests passed.
- 40 backend design and verified client-portal approval tests passed.
- Desktop and mobile browser workflows passed: folder creation without auto-entry, detail editing, comments, internal review, rejection remarks, revised upload, internal approval, client handoff, incoming portal decision, stable folder membership, archive and restore.
- Mobile horizontal overflow checked; screenshots visually reviewed.
- Web and core typechecks passed; changed production frontend files lint cleanly.
- Browser fixtures use synthetic data only. Test routes are development-only and excluded from production images.
- Authenticated live browser verification needs a fresh sign-in. No customer records were changed for testing.

## Deployment

Target: existing native VPS deployment, release `20260909-design-workspace`.
Web port: 13300. Core port: 18190. Previous release: `20260909-quotation-table`.
No database migration. Existing automated backup, readiness checks and proxy rollback apply.
Deployment status: live. The backup completed, both new services are healthy, and the proxy cutover succeeded.

Post-deployment verification:

- Public release header resolves to `20260909-design-workspace`.
- Public core readiness reports PostgreSQL healthy.
- Published Design module JavaScript contains the new library, file workspace and review-state labels.
- The browser fixture route returns 404 in production.
- Existing authenticated browser session had expired, so no live customer record was opened or modified during verification.
