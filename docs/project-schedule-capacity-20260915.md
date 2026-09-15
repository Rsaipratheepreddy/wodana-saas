# Project schedule and capacity backend — 15 September 2026

This is the locked backend contract for the tenant-wide project calendar. It is generic Wodana
SaaS behavior; no Palm Living terminology or branding is stored in the scheduling rules.

## What is now supported

- One portfolio calendar across all permitted projects and departments.
- Department, resource, project, member, booking-status, text, and date filters.
- Draft, tentative, confirmed, completed, and cancelled booking states.
- Exclusive people and crews, plus configurable exclusive or pooled factory/vendor capacity.
- Cross-project checks for the same resource and the same member.
- Working-calendar, timezone, inactive-member, approved-leave, project-hold, and vendor-
  acknowledgement checks.
- Documented calendar/leave exceptions for authorized managers. Confirmed resource/member/capacity
  collisions cannot be overridden.
- Department concurrency shown separately from hard resource/member/capacity conflicts.
- Department colors and tenant-visible names without changing stable IDs, codes, or API fields.
- Timed bookings together with milestones, promised procurement dates, deliveries, inspections,
  snags, site visits, next actions, handover, and target-completion dates.
- Overnight shifts and IANA-timezone snapshots, so historical bookings retain the calendar used
  when they were made.
- Idempotent writes, optimistic versions, project-revision checks, workspace advisory locking,
  immutable booking history, audit events, notifications, composite tenant foreign keys, and RLS.

## Default operating rules

- A task owns at most one active booking. Editing its dates or resource requires that booking to be
  released first.
- Draft work reserves nothing. Tentative work appears as demand and produces warnings. Confirmed
  work consumes capacity and is blocked by hard conflicts.
- People and crews are always one exclusive slot. Factories and vendors may be configured with a
  pooled numeric capacity.
- Resource calendars take priority. If none is set, enrolled employee calendars are intersected.
  Otherwise the workspace full-day fallback is used and snapshotted.
- Authorized calendar exceptions require a written reason. Confirmed collisions remain hard stops.
- Completing a task completes its confirmed booking. Cancelling a task cancels any active booking.
  A task cannot complete while its booking is draft or tentative. A project cannot complete until
  all draft/tentative bookings are resolved; remaining confirmed bookings then complete with it.
- Google busy periods remain a separate, non-authoritative integration overlay. Wodana bookings are
  the capacity source of truth for this release.

## HTTP contract

All routes are under `/api/v1/workspaces/:workspaceId/projects`.

- `GET /calendar` returns `events`, informational `items`, the department legend, `overlapCount`,
  and `conflictCount`. Required query fields are `from` and `to`; optional filters are
  `businessUnitId`, `resourceId`, `projectId`, `memberId`, `bookingStatus`, and `search`.
- `GET /schedule/availability` returns per-resource availability segments and department summaries.
  Segments expose confirmed use, tentative demand, remaining capacity, duration, and over-capacity
  state. Summaries include gap counts, gap minutes, available-capacity minutes, and conflict counts.
- `POST /:projectId/bookings/preview` validates a proposed booking without writing it.
- `PUT /:projectId/bookings` creates or revises a draft, tentative, or confirmed booking.
- `POST /:projectId/bookings/:taskId/cancel` cancels an active booking with a reason.
- `POST /:projectId/bookings/:taskId/complete` completes a confirmed booking.

Preview accepts `taskId`, `status`, `units`, optional `startTime`/`endTime`, `note`, and
`calendarOverride`. Save also requires a stable `requestId`, current `bookingVersion` (`0` for a new
booking), and current `projectRevision`. Cancel/complete require `requestId`, `bookingVersion`, and
`reason`.

## Access boundaries

Workspace owners/administrators with project scheduling permissions can see and manage the full
schedule. A project manager can manage assigned projects. A department team lead can manage that
department's schedule. Other members only receive resources they belong to. Every query and write
remains workspace-scoped; organization grouping never crosses the workspace data boundary.

## Verification result

The disposable full-funnel smoke creates a clean database, applies all migrations, runs the RLS
manifest check, creates project resources/tasks/bookings through authenticated APIs, verifies
idempotent replay, tentative warnings, project holds, cancellation history, calendar information
items, and proves that two parallel conflicting confirmations resolve as one success and one
conflict. The full backend verification currently passes 382 Business Core tests and 67
Intelligence/Automation tests.

Frontend calendar rendering and UAT are intentionally the next slice; this backend contract is now
stable for that work.
