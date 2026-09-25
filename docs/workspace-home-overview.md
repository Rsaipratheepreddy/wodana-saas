# Workspace Home overview

Home is a personal entry point inside the existing workspace shell. Its Overview, Sales, Planning, Projects, and My time tabs filter the same compact dashboard; Customize Home stores only widget visibility, width, and order for the signed-in member. Links open the underlying record, where changes are made.

## Data and rules

`GET /api/workspace/home-overview?workspaceId=…` proxies to `GET /workspaces/:workspaceId/home-overview`. The backend opens a tenant-scoped member transaction, checks each module permission, and returns bounded lists (five rows each) plus counts. Sales shows pending follow-ups owned by the member. Planning shows unreleased cases owned by or assigned to the member. Projects shows active, accessible projects and the member's unfinished tasks. Unavailable modules return `null` metrics and no records; loading or API failure never becomes a fabricated zero. Every SQL query binds the workspace and member identifiers.

Attendance uses the existing HRMS bootstrap and current-session endpoints. Home displays Check in or Check out according to the open attendance segment, but opens the established capture form so location, photo evidence, and policy validation are not bypassed. Saved layout updates use the existing versioned `home-layout` API.

## Acceptance checks

- Viewer without a module permission receives no queries or counts for that module.
- Personal and manager project visibility follow project assignments and `projects.manage`.
- Check-in and checkout show the correct action and retain HRMS capture validation.
- Home remains usable on mobile, in dark mode, and through keyboard navigation; errors offer retry.
