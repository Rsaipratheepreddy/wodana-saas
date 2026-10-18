# Palm task execution journey — local implementation checkpoint

The task is the unit of execution for office, factory and on-site work. A work package carries the approved scope, route, ownership, dates and start checks; each task carries one location, assignee/team, dates, dependencies, readiness, target quantity and approved output. Daily progress, material allocations, factory lots, installation batches, inspection, comments, files, followers and audit history attach to that task ID.

## User journey

1. Plan a work package and its tasks, materials and prerequisites in the project work plan. The package stays in Planning until its readiness checks pass.
2. Open a task from Home, the cross-project board, project next actions, a client update reference or a factory batch allocation. The shared task detail opens without routing through a project tab.
3. Read the task status, owner, dates, priority, package handoff, start checks, output and linked daily progress. Open full task details for subtasks, materials, updates, comments, files, followers and history.
4. Start or resume work only through `task_status`. The API checks commercial release, package readiness, approved design, dependencies, factory-to-site handoff, materials and bookings. Record daily quantities and evidence; review output independently before it counts as approved.
5. Resolve blocked work with a recorded reason, complete inspection and handover through their existing records. The task detail refreshes after status changes.

## Data and API dependencies

- `GET /api/projects/work-queue` builds the cross-project board; `GET /api/projects/:id/execution` supplies the authoritative task and connected-plan snapshot.
- `POST /api/projects/:id/execution` with `task_status`, task edit, report, inspection, comment and follow actions enforces revision and permission checks. File uploads use the project-file route.
- Project workflow stages remain separate from task status. This checkpoint does **not** implement the client's full 18-stage lifecycle. The built-in project workflow still has four stages, and the overview's five delivery groups are a summary, not the client's approval sequence.

## Verification and remaining acceptance

Focused web tests cover the shared detail, task routes and project workspace; backend tests cover package readiness, design, factory handoff, installation materials and task transitions. Local browser QA opened a sample task through `/workspace/tasks?projectId=…&taskId=…` and verified the in-page detail. The sample project's commercial release is not valid evidence of the Palm production funnel. Client-stage mapping, gate enforcement, historical migration, desktop/mobile/keyboard/RTL review and Palm end-to-end UAT remain open before claiming full flow acceptance.
