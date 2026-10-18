# Shared factory batches — first connected slice

## Journey and boundary

Factory has Projects and Batches tabs. A project manager creates a named batch, chooses one factory resource, a responsible foreman and compatible planned factory tasks from one or more projects. Record the common operation and specification/compatibility evidence. The server freezes each task's project, room, scope lines, drawing reference, quantity/unit, owner, resource, dates and project revision. Dates span the selected tasks. One complete task belongs to one non-cancelled batch; split-task allocation is deliberately unavailable in this slice.

The batch detail shows each project's frozen allocation and live approved output, QC status, dispatched and accepted-at-site quantities. Actions open the existing project task, progress and dispatch workflows. They remain authoritative for readiness, independent review, stock, QC and receipt. Batch creation does not release a project, start work, reserve capacity or approve output. Existing task bookings remain required; grouping does not merge or free those bookings. Naming a responsible foreman records batch coordination responsibility; it does not replace task owners or grant project access or reviewer permissions.

## State and action contract

- Create: `projects.manage`, active workspace owner/resource, 1–50 distinct planned leaf factory tasks, same resource/unit, positive quantities, released commercial scope, no existing output/report/dispatch history, matching project revisions and no previous active batch allocation. Compatibility evidence is an explicit planner attestation, not inferred manufacturing compatibility.
- Persist one workspace batch and relational allocations, not copies in project JSON. Unique active task allocation prevents double counting. A request UUID plus payload hash protects retries. Acquire the stock-transfer workspace lock, then factory command lock and sorted project rows; resource locks follow project rows. RLS and workspace composite foreign keys apply.
- Read: managers may see the global board; a project-specific read requires project access and returns only that project's allocations. Cross-project names/quantities are not returned through the project view.
- Cancel: manager, matching batch version, reason, every allocated task still planned and no production/dispatch history. Keep immutable history; release allocations for regrouping. No cancellation of started output through this module.
- Live state: cancelled, needs review (snapshot drift or missing task), planned, in progress, QC, ready to dispatch, dispatched or received. Output values are taken from existing ledgers and never written by this module. Resource/owner/date/source edits are visibly flagged instead of silently rewriting the snapshot.

## UI and API

Shared CRM controls, compact tabs, complete table grids, explicit loading/error/retry and preserved create/cancel drafts. Batch columns: batch, operation, workshop, owner, planned dates, state, action. Allocation columns: project/room, task, planned quantity/unit, approved quantity, QC, dispatched, received, booking and source changes; actions deep-link to project work. Quantities with different units are never totalled.

GET/POST `/workspaces/:workspaceId/projects/factory-batches`; optional GET `projectId` scopes reads. Dedicated same-origin web proxy. No supplier/client communication, deployment or migration execution in this task.

## Remaining after this slice

Partial task allocations, dedicated shared shift reservation, machine/skill eligibility, per-lot partial QC/rework/scrap attribution, shared costs/time, batch-owned report submission, and DB integration acceptance remain separate work. Existing whole-task QC and dispatch semantics remain unchanged. Do not label this a complete shared manufacturing execution system.

## Implementation and verification

- Migration: `services/business-core/drizzle/0113_project_factory_batches.sql`, registered in the journal. Three tenant-isolated tables hold batches, immutable allocations and idempotent command keys. **Not applied to any database.** Local Docker daemon is unavailable; SQL execution, concurrent database writes and tenant-isolation integration acceptance remain outstanding.
- Backend: `project-factory-batches.ts`, `project-factory-batches.service.ts`, controller/provider wiring in `projects.module.ts`. Only fully linked released BOQ scope can be grouped. QC does not automatically cover output approved after the last inspection. Historical cancelled allocations display no later output.
- Web: `/api/factory-batches`, `project-factory-batches.tsx` and CSS; global and project-specific Factory Batches views. Shared controls, grid borders, source-change flags, project action links, saved drafts, stable retries and explicit errors.
- 23 focused backend tests pass across domain/service, migration manifest and existing factory handoff; 6 UI/proxy tests pass. Both package typechecks and targeted new-file web lint pass. These are unit/mocked checks, not live database certification.
- Six desktop/mobile browser checks pass for global allocations, project scoping, grid borders, keyboard, RTL overflow, cancellation conflict evidence/draft retention, stable request IDs and creation through shared selectors with selected project revisions. Screenshots reviewed. No real project or supplier record was mutated.
