# Project workflow templates — backend contract

Status: implemented and API-verified on 15 September 2026.

This slice adds tenant-owned project stage terminology without replacing the existing project
execution engine. Tasks, dependencies, bookings, procurement, production, site work, quality,
snags, handover, finance and the independent project hold remain their existing authoritative
records.

## Safe default

When a workspace has no active default template, the API resolves a built-in neutral workflow:

1. Planning
2. Delivery
3. Handover
4. Completed

Delivery deliberately groups overlapping design coordination, sourcing, production and site work.
It does not impose a false sequential lock between those work packages.

## Tenant configuration

`GET /api/v1/workspaces/:workspaceId/projects/workflow-templates` returns the resolved default,
active workspace templates and the supported exit-gate keys. `PUT
/api/v1/workspaces/:workspaceId/projects/workflow-templates/:templateId` creates with version `0`
or updates with the current version. `POST
/api/v1/workspaces/:workspaceId/projects/workflow-templates/:templateId/archive` archives by
version; records are retained as evidence rather than deleted.

Each template has a stable code, visible name, description and two to twelve ordered stages. Each
stage has a stable key, tenant-visible name, description, lifecycle phase, optional project role
owner and a bounded list of supported exit gates. A template must move forward from Planning to a
final Completed stage. Custom executable expressions are not accepted.

The supported gates are deterministic facts already owned by the project module:

- project manager assigned;
- tasks planned;
- all tasks closed;
- all snags closed;
- all handovers accepted; and
- finance closed.

Only one active workspace template can be the explicit default. If that template is archived or a
workspace has never configured one, the built-in workflow is returned without inserting tenant
data. Writes require `projects.manage`; reads require `projects.view` or `projects.manage`.
Templates use optimistic versions, row-level tenant isolation and audit/outbox events.

## Project adoption and movement

Planning a project or releasing an accepted Deal File freezes the workspace's resolved default
template into that project. The template ID, code, name, version, stage definitions and gate keys
therefore remain stable even when an administrator changes the default for future projects. A
pre-release planning project keeps the template it originally adopted when commercial release is
completed.

The existing idempotent execution command accepts `workflow_transition`. Only a user with project
management permission can move the management stage. Forward movement is one stage at a time, checks every configured
exit gate against the existing authoritative project records, cannot move into an operational
phase before that phase's existing controls are complete, and is blocked by an active project
hold. Returning to any earlier stage is allowed with a mandatory reason so rework is represented
honestly rather than erased.

The Completed stage remains reachable only through the existing project-completion command. That
command still enforces work, handover, snag, procurement, milestone, stock-transfer, payment and
finance closure before adding the final workflow history event. Until the workflow UI is connected,
a valid existing closeout may synchronize directly from its current management stage to Completed;
the history records the observed configured gate results without weakening the authoritative
closeout checks. Reopening moves the workflow back to its preceding stage with the required
reopening reason.

Every stage movement records actor, time, from/to keys, note and evaluated gate results. Portfolio
responses include the current and next visible stages, accountable role/member and current gate
results. The client project response exposes only the safe current stage key and visible name.

Project hold is still an independent overlay rather than a fake workflow stage. Its current reason,
owner and start time remain in project controls; place, update and release events now preserve a
separate history, including the original reason and owner after release.

## Verification boundary

The disposable API funnel proves built-in fallback, creation of a workspace default, stale-write
rejection, safe archival, fallback restoration, migration replay, the RLS manifest, per-project
template freezing, an API stage transition, gate enforcement, and hold/release history. Focused
tests cover validation, permissions, optimistic versions, frozen copies, stage order, operational
bypass prevention, configured gate facts, safe completion and audit calls.
