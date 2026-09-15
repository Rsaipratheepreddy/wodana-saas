# Engagement core

The canonical post-CRM aggregate is the existing `pre_project_cases` record. “Engagement” is the internal product concept; `pre_execution` remains the default tenant-visible terminology and can be overridden per workspace.

## Boundary

- A qualified CRM opportunity can have at most one engagement.
- The engagement belongs to exactly one workspace. Customer-account organisation grouping never permits data to cross workspace boundaries.
- Existing preparation, design, commercial and delivery records keep the same `case_id`; there is no competing aggregate or destructive cutover.
- A new engagement inherits an active CRM owner when possible and otherwise assigns the active member who starts it.

## Lifecycle and phase

Lifecycle and working phase are independent:

- Status: `draft`, `active`, `on_hold`, `released`, `cancelled`.
- Phase: `discover`, `define`, `design`, `price`, `agree`, `release`.
- Holding preserves the phase and blocks preparation, commercial, portal-decision and project-planning writes until resume.
- Cancellation requires a reason. Reopening requires a reason and a linked CRM opportunity in `open` or `won` state.
- Released is terminal for engagement lifecycle. Post-release commercial variations remain governed by the existing commercial controls.
- Moving to the next phase is direct. Skipping a phase or moving backwards requires a reason; this keeps iteration possible without hiding exceptions.

## Command safety

- Lifecycle/profile commands require `pre_projects.manage_lifecycle` plus view permission.
- Every command carries an expected engagement version and a workspace-scoped UUID request ID.
- The request ID is stored with a canonical payload hash and response. An exact retry returns the original response; reused IDs with different intent are rejected.
- Row locks plus optimistic versions serialize concurrent changes. Audit and outbox records commit in the same database transaction.
- Current hold and cancellation metadata are stored on the engagement; historical states and reasons remain immutable in audit events.

## Compatibility

- Existing `active` and `released` cases retain their meaning.
- Legacy `archived` cases migrate to `cancelled` with an explicit migration reason. The old `archived` list filter remains accepted as an alias for `cancelled`.
- Delivery release sets engagement status and phase atomically and records release actor/time.

## Deliberately deferred

The work-item/dependency/decision graph, derived next action/readiness, catalog hardening, and the unified frontend are separate slices. No synthetic progress percentage or duplicate source of truth is introduced in this core slice.
