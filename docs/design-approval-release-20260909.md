# Design folders and approval release

Live release: `20260909-design-approval` at https://iglo.wodana.ai.
Web: `13260`; business-core: `18170`.

- Folder-first Designs tab with Room, Item, or Room + item selection. Names come from the selection; duplicate context is checked in the UI and under the existing case lock on the server. Creating a folder stays on the list.
- One-screen uploads inherit folder context and take only files, per-file design types and notes. Existing files use a compact header and simple preview.
- Four workflow tabs: Designs, Internal approval, Client approval, Approved. Assigned internal reviewers approve or reject with remarks; internally approved files can be sent to the client portal. Rejected revisions return to Designs.
- Portal approvers approve or reject the exact latest published revision with a separately verified OTP. Server checks the active case, grant, current revision and status. Verified retries are idempotent. Client decisions carry the client's grant identity, never a substituted staff identity.
- Comments replace thread controls. Existing discussion messages remain visible as comments, and do not block approvals.
- The Client approval view refreshes while visible and on window focus.

Validation: web/core type checks, targeted lint, production builds, 22 focused frontend tests and 310 backend tests passed (10 existing backend tests skipped). The full frontend run had 486 passes and two unrelated 5-second timeouts; both passed in isolated reruns.

Live read-only verification covered room/item loading, automatic combined folder names, duplicate prevention, all four tabs, file previews, single-screen upload, compact header and the internal-review form. No real design was submitted or approved as a test. Portal approval/rejection was verified with automated UI and backend tests.

Migration `0052_client_design_approval` permits explicitly attributed client activity without an internal user actor. It was rehearsed in a rolled-back transaction and applied after a full backup. Existing design data was preserved. Deployment and rollback records are in `/opt/wodana/releases/20260909-design-approval`; the previous services remain available for rollback.

The deployment helper now supports backend releases and this reviewed migration. Subsequent web-only deployments detect the live backend port instead of reverting to an older backend.
