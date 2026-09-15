# CRM SLA accountability — 15 September 2026

This backend slice makes first-response SLA ownership and operational escalation deterministic. It
does not add frontend behavior or contact external providers.

## Contract

- A new SLA cycle captures its authoritative lead owner and queue in both queryable columns and the
  immutable policy snapshot.
- Reassignment transfers responsibility only while the SLA is live. The append-only history keeps
  the previous and new owner/queue; stopped cycles remain frozen for reporting.
- Every live first-response SLA has one linked response task. An earlier customer commitment remains
  the next action; otherwise the SLA task becomes the next action.
- Warning promotes the linked task to high priority. Breach promotes it to urgent priority. A task
  closed without response evidence is recovered because the still-live SLA remains authoritative.
- Delayed workers record warning and breach at their actual policy thresholds, not at worker run
  time, and state predicates plus row locking prevent repeat transitions.
- Verified human response evidence records schedule-aware elapsed minutes. A response received while
  paused freezes at the pause boundary.
- SLA reporting uses measured response evidence, supports legacy fallback rows, groups by the frozen
  accountable owner/queue, and exposes compliance plus median and p90 response time.
- Tenant reference triggers reject cross-workspace owners and queues. Unassigned breaches remain
  visible in personal Today queues.

## Verification

- Focused SLA/accountability/reporting tests pass.
- The complete Business Core suite passes.
- TypeScript typecheck and production build pass.
- Clean migration replay, tenant-isolation verification and the isolated full-funnel smoke pass.
- A populated database clone upgraded from migration 0052 through 0065 with all 21 historical SLA
  rows backfilled without accountability mismatches.
- The real PostgreSQL report queries and warning-to-breach task promotion path were exercised inside
  rollback-only transactions.
