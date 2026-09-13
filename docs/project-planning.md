# Plan & teams — seeded working version

Scope review: this demo is incomplete as an execution module. [Projects module — v1 scope baseline](projects-scope-v1.md) defines its replacement contract: compact task/subtask views, assignments, comments and report-reviewed progress. The direct progress slider and large summary header are demo behavior, not the planned production workflow.

Open `/workspace/projects/demo/plan-teams`.

This version implements a browser-persisted demo with eight work packages, seven crews, three bookings on other projects and one team absence. The seed scenario is dated 7 September 2026. No live customer, workforce or accounting records are changed.

## Daily workflow

1. **Work plan:** search and filter tasks by location, status, missing team or attention needed. Open a task to edit its BOQ reference, area, trade, dates, predecessor, team, readiness, progress and notes.
2. **Team availability:** inspect the weekly calendar across the seeded projects. Current-project bookings open the editor. External bookings and absences are read-only. Previous/next week and site/factory filters change the calendar; adding work carries across the selected team and week.
3. **Resolve a clash:** the initial wardrobe fabrication proposal overlaps Joinery team A’s Dubai Hills booking. Select the suggested Joinery team B, review the dates, then confirm. Both views update and survive reload.

## Booking rules

- A draft is a proposal and does not reserve capacity.
- Confirmation reserves the whole crew for each working day. This seed calendar has Sunday off; it is a demo configuration, not a UAE labour-rule assumption.
- Confirmation rejects overlaps with other reserved work or absences, incompatible trades/locations, invalid dates and dependency conflicts.
- A free team can be booked before materials arrive. Starting or completing work also requires readiness checks and a completed predecessor.
- Extending a booked task flags affected downstream bookings. Dates are never silently moved.
- The editor checks the latest browser snapshot again on save and rejects overwriting a task changed in another tab.

## UI and accessibility

Uses existing semantic theme tokens, the lilac–rose–peach brand gradient, shared DataTable, Tabs and InspectorSheet. Table and calendar scrolling stay inside the content area. The inspector traps focus, restores it on dismissal, confirms discarding unsaved edits and focuses validation errors. Dark mode, RTL, reduced motion and 320–1440px layouts are supported.

## Storage boundary

Local storage key: `wodana:projects:demo:plan:v1`. Edits are confined to this browser and this demo. Reset requires confirmation. Storage failures are shown without claiming a successful save.

The next production integration needs authenticated, workspace-scoped records, transactional capacity enforcement, real BOQ/resource links, permissions, audit history and configured calendars. Factory machine capacity, individual shifts and external-vendor capacity confirmation are outside this initial whole-crew demo.
