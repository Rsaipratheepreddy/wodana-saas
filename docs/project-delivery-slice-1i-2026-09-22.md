# Slice 1I — amendment reviewer ownership and global approvals

New amendment proposals require an eligible independent reviewer and review due date. Eligibility uses existing server-derived project-access + review-permission membership lists. Only that reviewer can approve/reject; proposer retains withdrawal. Legacy unassigned proposals remain visible in Open and can be withdrawn and resubmitted; they are not silently assigned.

Global Tasks → Project approvals aggregates RFAs and order amendments from their canonical records. Rows identify type, project, responsible person, due date and exact source link. Submitted amendments belong to the reviewer; terminal amendments appear in All only. Search, tenant/project authorization and keyset pagination operate over the combined source. Prefix amendment queue IDs to prevent collisions with RFAs. No evidence, pricing or supplier notes are exposed in the global projection. No copied CRM tasks.

Order links open the owning order directly on Amendments and focus the exact proposal, retaining full history on demand. Reviewer and due date appear in the order table. Review permissions and all existing financial checks remain server-side. This slice does not send notifications or change production settings.

Validation: 18 focused backend tests, 14 UI tests and 6 desktop/mobile browser checks passed. Browser checks cover RFA queue regression, amendment queue links, exact-proposal navigation, keyboard review actions and RTL overflow. Both TypeScript checks and targeted component lint passed. APIs and database access were mocked for these tests; the combined PostgreSQL query still needs live integration verification before deployment. No production changes, supplier messages or notifications.

Next: reassignment and recovery when a reviewer is unavailable, followed by broader execution/procurement tasks in the global board. Existing unassigned amendment proposals require withdrawal/resubmission by the proposer; this slice does not grant other reviewers authority to decide them.
