# Factory closure audit — 22 September 2026

## Result

The current implementation supports grouping complete planned factory tasks from multiple projects, with frozen source references and live output/QC/dispatch information. It is not a complete manufacturing execution system. This audit did not change a database or deploy an API.

## Correctness fixes

- `project-schedule-capacity.ts`: normalize the calendar dates of availability segments split around midnight. Previously a post-midnight segment retained the previous date, and a segment ending exactly midnight omitted its end date. This could show a valid free/busy interval against the wrong day. A regression covers a 20:00–06:00 shift with a 00:00–02:00 confirmed booking and checks capacity minutes.
- `project-factory-batches.service.ts`: the batch booking indicator now requires a confirmed booking on the current task's resource covering its entire current date range. Previously any confirmed booking matching the frozen task/resource was enough, including a partial or outdated booking. Three service regressions cover full coverage and missing coverage at either end. Actual booking confirmation remains authoritative.

## Scope still missing

1. **Partial task allocation across batches.** `project_factory_allocations` has a unique active `(workspace_id, project_id, task_id)` index. `create` snapshots the entire task quantity and accepts no allocation quantity. A task cannot be split between two live batches. This needs a quantity ledger and locked conservation checks, not only an extra UI input.
2. **Shared shift reservation.** Batch `command` accepts only `create` and `cancel`; it does not write `project_bookings`. Existing task reservations are independent. Grouping ten wardrobes does not consolidate their crew/machine capacity or establish a shared run reservation.
3. **Machine/skill eligibility and workload units.** Capacity validates exclusive/pooled units and calendars. Batch compatibility checks the selected resource and quantity unit, while the compatibility text is a planner attestation. It does not calculate machine routing, required skills, setup time or production throughput from catalog specifications.
4. **Batch-owned output and shared time/cost.** `factoryAllocationView` reads approved quantities and inspections from project tasks and dispatches. The batch API has no report/production/time/cost command. A single shared shift report cannot allocate approved output or labor cost across projects through this module.
5. **Lot-specific allocations across multiple batches.** Existing task lots and QC remain separate from relational batch allocations. The batch view aggregates task output; it cannot distribute a task lot's partial rejection/rework/scrap among several allocations, because those allocations do not yet exist.

## Existing protections observed

- Create validates released/open projects, planned leaf tasks with no report/dispatch history, positive quantities, the same resource/unit, scope references and project revisions.
- Workspace advisory locks precede sorted project row locks; unique active allocation and request-key hashes prevent duplicate ownership and conflicting retries.
- Project-scoped reads query only that project's allocations. Global reads and batch mutations require management permission.
- Cancellation is version checked and refuses started output; historical cancelled allocations do not inherit later production.

## Evidence boundary

The focused factory batch/domain/capacity tests are unit and mocked-service tests. They do not certify simultaneous real database writes, all role combinations, or every end-to-end manufacturing exception. Earlier documents saying migration 0113 was never applied describe their original slice; this audit makes no assertion about later local smoke database runs.

Do not mark shared factory production complete until the quantity/reservation/reporting capabilities above and their persisted concurrent/role acceptance scenarios are implemented and pass.

## Partial-allocation dependency decision

Do not remove the active task uniqueness constraint in isolation. `factoryAllocationView` currently copies `task.approved` and sums dispatches by `taskId`; the table labels those values as each batch allocation's approved/sent/received quantities. Two live allocations would therefore each claim the same output. `factoryBatchState` could then falsely mark both batches received. Marking those numbers unknown would avoid false reporting, but would leave a planning-only feature with no path to finish an allocation.

Implement this as a connected slice in the following order:

1. Give allocations stable IDs and explicit allocated quantity/unit, retaining the immutable full task snapshot separately. Existing whole-task requests default to the remaining allocatable quantity only under an explicit backward-compatibility contract.
2. Under the existing sorted project locks, enforce that active allocated quantities never exceed the current task quantity; reject source quantity reductions below allocations. Preserve cancelled history and idempotency. Replace uniqueness only after the conservation invariant exists on every relevant task/batch mutation.
3. Add allocation lineage to approved output/production lots, inspection, rework/scrap and dispatch. Each quantity must have exactly one allocation owner. Existing whole-task records need an explicit legacy attribution rule; do not guess proportional progress.
4. Update factory reporting and batch UI together: show allocated quantity, remaining quantity and allocation-owned progress; offer explicit allocation selection when recording output. Unknown legacy attribution must display as unknown, never zero or duplicated completion.
5. Test two projects sharing a run and one task split across two runs, including concurrent allocation attempts, partial output/QC/rework/returns, cancellation, source revisions and independent reviewer access. Verify stock/dispatch/site receipt conservation in persisted API scenarios.

No speculative partial-allocation migration was added during this audit. Keeping the whole-task constraint preserves correct existing behavior until this connected implementation is ready.
