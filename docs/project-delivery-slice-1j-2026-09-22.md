# Slice 1J — amendment reviewer recovery

Pending amendments can be reassigned by a project manager or their proposer with procurement permission. The replacement must have current project access and review permission and must not be the proposer. Reviewer, due date and a reason are required; a no-op is rejected. Unassigned legacy proposals use the same recovery action. Decided amendments cannot be reassigned.

Keep the same amendment identity, proposed terms, evidence and financial state. Append previous/new reviewer and due date, actor, time and reason to assignment history. Global My work follows the current reviewer after refresh; old reviewers immediately lose decision authority. Existing project revision/idempotency and locking protect stale edits. Reassignment does not waive approval, budget, release or fulfilment checks.

UI: contextual Reassign reviewer in the existing amendment row, using the current modal controls. Reviewer history is collapsed within the row. No extra main tab or duplicate task. No emails/messages are sent. RFAs retain their existing workflow; this slice covers order amendment recovery only.

Verification: 22 focused backend tests, 15 UI tests and 2 desktop/mobile browser checks passed, along with both TypeScript checks and targeted lint. Tests cover manager recovery of unassigned proposals, proposer permissions, invalid/no-op assignments, immutable financial terms, retained history, the old reviewer's immediate loss of authority, and stable global task identity with changed ownership. Browser checks cover keyboard entry to reassignment and its required fields; screenshots inspected. API/DB fixtures only, no live database mutation or deployment.

The overall remaining scope is tracked in `project-delivery-progress-2026-09-22.md`. Next priority is the purchased-item vertical journey rather than more standalone approval features.
