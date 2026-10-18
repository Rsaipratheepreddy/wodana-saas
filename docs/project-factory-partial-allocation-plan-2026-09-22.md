# Partial factory allocations — implementation contract

Status: design only; no partial-allocation writes or migration enabled. This crosses production approval, lot QC and dispatch. Adding only batch quantity fields would make the delivery view incorrect.

## Data contract

### Relational allocation

Extend `project_factory_allocations` with `id uuid`, `quantity numeric`, `unit text`, `version integer`. Keep `snapshot` as the immutable full task snapshot; do not replace `snapshot.quantity` with the allocation quantity. Keep the existing `(workspace_id,batch_id,project_id,task_id)` identity to allow at most one allocation of a task within a batch. Add unique `(workspace_id,id)` for lineage references. Existing rows receive IDs and quantity/unit from their snapshots.

Only after all command checks exist, replace the unique active task index with a nonunique active lookup index. Allocation conservation is `sum(active allocation.quantity) <= current task.quantity`, under sorted delivery project row locks shared by task mutations and batch mutations. Use the same defined quantity tolerance as the execution ledger; reject NaN, zero, negative and mismatched units at the boundary.

Latest migration at this audit: `0113_project_factory_batches.sql`. Reserve a new sequential migration only at implementation time after checking the journal; do not assume 0114 remains free. Backfill must stop with a diagnostic on malformed snapshots rather than silently inventing quantity/unit.

### Production lineage

- Report entry: optional `factoryAllocationId`. Required for new factory output whenever the task has active batch allocations. Existing unsplit/nonbatched task report entries stay valid.
- Factory lot: separate its type from the current alias of `installationBatches`; add optional `factoryAllocationId` and `sourceReportEntryIds`. A lot must contain output from one allocation only.
- Dispatch: retain `factoryLotId`; allocation is derived from the referenced lot, never accepted as a conflicting independent value. For split tasks require a lot before dispatch.
- Correction report: retain original allocation identity; prevent moving previously accepted output between allocations by changing an entry ID or attribution.
- Review history continues to record independent reviewer, evidence and timestamps. No color/status change substitutes for ledger approval.

Store lineage in existing project execution JSON alongside entries/lots first, with validation inside the same project transaction. Do not dual-write a second approved-output ledger without an atomic authority contract.

## API actions

`factory-batches/create.tasks[]` adds optional `quantity`. Omitted quantity preserves the original whole-task behavior: it requests the entire current task quantity and rejects if another active allocation already consumes any of it. It must not silently change an old client's intended quantity to a remainder.

The create response exposes `allocation.id`, `quantity`, `unit` and the full source snapshot. Candidates expose `allocatedQuantity` and `remainingQuantity`; available candidates may include a partly allocated planned task. Keep the existing rule that batch allocation cannot start after any production/report/dispatch history until a separate amend-allocation workflow is designed.

`report_submit` requires explicit allocation on each applicable entry. `approve_report` checks cumulative approved output per allocation against its quantity as well as the existing whole-task material/scope constraints. Pending reports must not be treated as approved output; approval rechecks under locks.

`factory_lot` requires allocation ID for split work and validates its quantity against approved, un-lotted output for that allocation. `factory_lot_review` preserves existing independent inspection. `dispatch_save`/dispatch validation must derive allocation from the lot and conserve passed quantity after dispatches and returns. Cancellation refuses an allocation that has any attributed report or lot history, not just positive current output.

## Requested execution-layer changes

These are required before removing database uniqueness; this plan does not edit `execution.domain.ts`.

1. `ExecutionService` loads the task's active allocations under the existing project lock and supplies a validated allocation map to the domain actor/context. Never trust allocation quantities from client JSON.
2. In `report_submit` and report correction handling, validate allocation existence, project/task ownership, unit and attribution immutability.
3. In `approve_report` (currently around line 1340), evaluate approved output per allocation, preserving existing material, task quantity and correction guards.
4. In `factory_lot` (currently around line 1377), calculate available approved quantity by allocation, record source lineage and reject unlabeled split-task lots.
5. In task edit/cancel flows, reject quantity/unit/resource changes incompatible with live allocations; source-change badges alone cannot enforce conservation.
6. In factory dispatch validation, use the lot's allocation and passed quantity; keep legacy unsplit dispatch compatibility explicitly isolated.

## Read/UI contract

Batch totals use allocation-owned reports, lots and lot-linked dispatches. Do not copy `task.approved` into every allocation. `factoryBatchState` compares received quantity with allocation.quantity. Legacy whole-task batch records can use the current whole-task projection only while they have exactly one whole-task allocation and no ambiguous history.

Factory batch creation uses one quantity input per selected task, showing remaining capacity in the task's own unit. The allocation table shows Allocated / Approved / QC / Sent / Received with exact units. Production/report forms offer eligible allocation choices and cannot guess the first batch. Existing task-level totals remain the sum of allocation outputs plus valid legacy unallocated output.

## Required acceptance tests

1. Whole-task old payload creates the same quantity; repeated request ID returns the same batch; conflicting retry rejects.
2. A quantity-10 task splits 4 + 6; 4 + 7 rejects. Parallel attempts to allocate 6 + 6 permit only one successful write.
3. Cross-workspace and cross-project report allocation IDs reject; project-scoped reads expose no other project's allocations.
4. Approve 4 output to A and 2 to B: task approved=6; A approved=4; B approved=2. Neither batch displays 6.
5. Submit two reports within limit but approve both beyond one allocation: second approval rejects atomically.
6. QC pass A=4; B rework=2. Dispatch A=4 succeeds; B dispatch rejects. Site receipt credits only A's linked quantity.
7. Partial A receipt, rejected return, rework and redelivery conserve net dispatched and accepted quantities without crediting B.
8. Correction cannot reduce approved allocation output below committed lots/dispatch; cancellation cannot erase attribution history.
9. Shrinking or changing unit/resource of the source task cannot invalidate active allocations silently.
10. Existing nonbatched factory flow, whole-task batch flow and independent reviewer restrictions continue to pass.
11. Migration/backfill, tenant RLS, real transaction race tests, browser entry/lot/dispatch forms and recovery after stale revisions pass before activation.

## Delivery boundary

This is larger than a safe isolated schema/backend batch patch because output commands and their forms must become allocation-aware together. The current safe whole-task path remains enabled. Do not expose partial allocation writes before the connected slice above is implemented and tested.
