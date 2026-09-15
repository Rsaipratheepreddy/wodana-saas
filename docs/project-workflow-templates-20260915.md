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

## Verification boundary

The disposable API funnel proves built-in fallback, creation of a workspace default, stale-write
rejection, safe archival, fallback restoration, migration replay and the RLS manifest. Focused
tests cover validation, permissions, optimistic versions and audit calls.

Project adoption, frozen template snapshots, stage transitions and stage history are the next
backend slice. Until that slice lands, this contract does not claim that changing a template moves
an existing project or enforces a project transition.
