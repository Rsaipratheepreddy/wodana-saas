# Design folders and review

Operations web scope, 7 September 2026. Referred to the legacy `Wodana-Frontend/web/components/design/pre-project-design-workspace.tsx` and its folder/review models. Uses the current Wodana controls, compact layout, pale folder surfaces and themed dialogs.

## User flow

- Open Design to see named folders. Create any folder name, optionally choose a default room, and open the whole card. Existing documents are preserved under Unfiled.
- Add several images/PDFs together. Two short steps: choose files, then confirm names, folder, type and optional room/item. Each file becomes a separate design document with revision 1. The server saves the batch atomically and recognizes an identical retry.
- Open a file into a full-page studio with a large image/PDF canvas, image zoom, revision picker and discussions alongside it. Folder/file selection is retained in the URL for refresh and browser navigation. Compact headers leave room for the work; discussions move below the canvas on narrow screens. Uploading a replacement explicitly creates the next revision of that file. Moving between folders does not replace files or rewrite decisions.
- Add quick feedback in **Add a comment**, or start a thread for a discussion or decision. Comments and replies are internal and belong to the selected file revision. A comment on an earlier revision does not move or approve the current revision. Replies open inline beneath their topic; authors and times are shown with clear separators. Failed submissions retain the typed text.
- Start a discussion for each idea or issue on the exact revision. Replies stay within the thread; the author or assigned reviewer can resolve/reopen it. Blocking discussions must be resolved before internal approval, preparing client review, or recording client approval. New replies increment the thread version so an outdated screen cannot silently resolve unread feedback. Approved revisions cannot acquire or reopen a blocking issue; start a new draft revision.
- Request internal review from a named eligible workspace member. Only that reviewer with design review permission can approve or request changes. Existing legacy reviews without an assignee can be completed by a permitted reviewer.
- An internally approved current revision can be prepared for client review. Staff recording an offline client decision need a separate permission, client name, decision date/time, channel and evidence reference. The activity records the staff account separately from the client.
- Changed files start as drafts. Earlier approved revisions remain visible, and an older revision cannot be approved as if it were current. Review context (room, scope and document type) cannot be changed after that revision enters review. Create a new draft revision first.

Site and Brief entries support multiple photos/PDFs on one record. The shared control shows attached count and remaining capacity, accepts up to 20 files per record and 20 MB per file, preserves earlier attachments, and retains successful uploads if a later file fails.

## Integration contract for the client portal task

This implementation does not publish designs to clients or send review invitations. `client_review` means the operations team prepared an exact revision; it is not proof that a client has received it.

The existing workspace API remains internal: `GET /workspaces/:workspaceId/pre-projects/:caseId/designs` returns files, folders, internal discussion threads, activity and operations permissions. Do not expose this payload directly through a client endpoint.

The client integration should use authenticated case-contact access and an explicit sharing/request record pinned to `designId` and `versionId`. Only deliberately shared versions and client-visible comments/assets should be exposed. Internal drafts, reviewer notes, Site evidence, costs and unrelated case files remain private. The client decision must derive contact identity from the authenticated session and record the request/revision acted on. Clients must not be able to choose an arbitrary workspace user or use the staff `decisionBy` field as authentication.

Staff activity accepts only `email`, `meeting`, `phone` or `document` decision channels. `client_portal` is deliberately rejected on the staff endpoint; add the authenticated client handler with the portal integration. Recheck current revision/request status transactionally before accepting a decision. Uploading a new revision must never inherit an earlier approval. Decide notification delivery and client visibility with that integration, rather than treating all folder files as shared.

Folders are organizational. Folder counts are not a combined approval. A BOQ/specification references an exact file revision; approval here does not by itself release fabrication or execution. Approval center routing and formal release remain separate integration work.

## Storage and checks

Migration 0036 adds tenant-scoped folders, file-folder references, assigned reviewer references and attributed decision fields. File activity is append-only for the application role. Migration 0038 adds revision-scoped discussions and immutable replies under tenant isolation. PDF inline viewing uses the same authenticated asset endpoint as downloads. Dates use the portal locale and time zone consistently during server/client rendering. No existing file IDs or revisions are rewritten. Existing approved decisions remain readable with legacy attribution.

Verification covers folder CRUD and duplicate/stale checks, cross-case references, multiple attachments on Site/Brief, atomic upload rollback, retry safety, assigned reviewer authorization, client attribution and channel checks, reviewed-context protection, new-revision approval reset, private files and tenant isolation. Browser checks use disposable cases; existing tenant data is preserved and unused temporary operational records are removed after verification while audit history remains. The latest primary Design test case was retained after new manual discussions appeared, so those contributions remain available.

Latest studio checks: 18 design service tests, 7 relevant web component tests and 59 live API assertions passed, in addition to earlier Site/Brief checks. Web/backend typechecks and targeted lint passed. Live assertions include discussion creation/replies, revision isolation, stale resolutions, authorization, retry safety and blocking approval gates. Private PDF inline/download headers were checked separately. Browser verification covered full-page opening and refresh, image/PDF viewing, threaded replies, blocking selection, resolution, reviewer selection and both portal themes. An initial date-format hydration mismatch was fixed and the refreshed page checked again. The client-portal delivery/decision connection remains the separate integration described above.
