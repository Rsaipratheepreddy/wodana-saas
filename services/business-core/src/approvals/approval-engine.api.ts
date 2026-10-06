/**
 * E3 — the approval engine (plan §0.3b, §6.9a, edge cases E3-1…E3-6). One engine; every module calls it.
 *
 * README
 * ------
 * What it does
 *   - A workspace has approval *policies* per subject kind (rows: `approval_policies`, `approval_policy_versions`,
 *     `approval_policy_steps`): which amounts they cover (≥ X in a currency), approvers in order (a permission, a role
 *     or a named person), the Owner above an amount, hours before a step escalates to the next approver, whether a
 *     recorded separation-of-duties waiver is allowed, and the tolerance before an amount change resets approvals.
 *   - A module opens a *request* for one subject (`approval_requests`); people decide its steps in order
 *     (`approval_decisions`, append-only). The request keeps the policy version it was opened under (E3-4).
 *   - Separation of duties: the requester never decides, nor does anyone who decided an earlier step (E3-2). A waiver
 *     is possible only when the policy allows it, with a note, and is recorded.
 *   - Away: a person delegates (`approval_delegations`); the delegate decides for them and the decision records whom
 *     it was for. After the escalation hours, the next step's approvers (the Owner on the last step) may decide (E3-1).
 *   - An amount change after a decision resets the approvals when it crosses a threshold or exceeds the tolerance;
 *     the new request shows the old and the new amount (E3-3). An expired request can't be approved (E3-5).
 *   - Two approvers at once: the request row is locked and version-checked; one wins, the other gets 409 with the
 *     final state (E3-6). Every command is audited; `commandId` makes a decision replay-safe.
 *
 * How a module uses it (always inside its own tenant transaction, with the same `db` client):
 *   const status = await requestApproval(db, { workspaceId, kind: "quote_qs", subjectId: quoteId, title: "Q-12 · Kitchen",
 *     amount: "185000.00", currency: "AED", requesterUserId: user.userId, href: `/workspace/...` });
 *   const after = await decideApproval(db, { workspaceId, kind: "quote_qs", subjectId: quoteId, deciderUserId: user.userId,
 *     decision: "approve", note, expectedVersion: status.version, commandId });
 *   if (after.status === "approved") { ...the module does its own effect... }
 *   const now = await approvalStatus(db, workspaceId, "quote_qs", quoteId);  // null when never requested
 *   // Who may decide, for a screen: now.currentStep, now.waitingFor (names), canDecide(db, now, userId).
 *
 * A kind without a policy gets the product default the first time it is requested (DEFAULT_APPROVAL_POLICIES), so a
 * workspace never needs setup; firms edit policies in Settings → Approvals (each edit is a new version).
 *
 * The Approvals inbox ("Waiting for you") lists every pending request a person may decide, except kinds that already
 * have their own inbox row (`KINDS_WITH_OWN_INBOX_ROW`: add yours there if your module lists it itself). Deciding a
 * generic row from the inbox calls `decideApproval` and then the kind's outcome handler (`approval-outcomes.ts`).
 */
export {
  APPROVAL_SUBJECT_KINDS, DEFAULT_APPROVAL_POLICIES, KINDS_WITH_OWN_INBOX_ROW,
  type ApprovalDecision, type ApprovalRequestStatus, type ApprovalStatus, type ApprovalStepView, type ApprovalSubjectKind,
  type ApproverKind, type PolicyStepInput,
} from "./approval-policy";
export {
  amendApprovalAmount, approvalStatus, canDecideApproval, cancelApproval, decideApproval, requestApproval,
  type AmendApprovalInput, type DecideApprovalInput, type RequestApprovalInput,
} from "./approval-engine";
