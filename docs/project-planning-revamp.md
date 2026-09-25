# Project planning tabs

The project execution record supplies the workspace and linked planning case IDs. The new project route must reuse that case, never create duplicate requirements, designs, or quotations.

## Journey and fields

- Requirements opens existing requirement cards. Search and room/archive filters lead to the existing note/specification editor: title, description, room, quantity, unit, scope status, dimensions, attachments and reference links. Existing actions cover create, edit, archive/restore, room management and project brief.
- Design opens existing folders and file cards. Uploads retain requirement/room links, metadata, revisions, reviewers, annotations and review actions. Opening or closing a file must preserve the project's Planning tab.
- Quotations opens existing quotes as cards with a table alternative: title, version, status, amount, currency, validity and item count. Create/open continues into the existing full quotation editor and review workflow; no second pricing or approval implementation.
- Change Requests uses the same commercial record and existing request, revision, decision and variation workflow.

## API and rules

- GET `/api/workspace/pre-projects/:caseId/brief?workspaceId=…` supplies requirement data and edit permissions.
- GET `/api/workspace/pre-projects/:caseId/designs?workspaceId=…` supplies files, folders and review permissions. Existing scoped write/upload/review endpoints remain authoritative.
- GET `/api/workspace/pre-projects/:caseId?workspaceId=…` and `/api/commercial/cases/:caseId?workspaceId=…` supply the quote context, versions and commercial permissions.
- Load only the selected panel. Failures expose Retry, not an empty record list. A missing case link is explicitly reported. Cancel obsolete loads on section/project changes.
- Server permissions, optimistic versions and approved/released scope rules remain intact. No seeded or fabricated fallback records. No deployment.
- Keep compact navigation styles scoped to the two project tab rows, not the nested editors and dialogs.

## Verification

Test correct workspace/case URLs, permissions passthrough, real empty states, retries, stale load cancellation, scoped design-file navigation and existing CRUD/review suites. Verify card links and keyboard-accessible controls.
