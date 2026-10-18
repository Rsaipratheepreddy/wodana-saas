# Planning and Production project lists

The project portfolio has two URL-backed destinations: `?view=planning` (default) and `?view=production`. Reuse the existing project table, icons, search and status filter.

- Planning contains unlinked planning cases and delivery projects whose phase is still planning.
- Production contains released execution projects, including handover and completed projects; these remain distinguishable in the existing Stage and Status columns.
- A linked case is not duplicated as a separate row. For an existing project, show explicit Planning and Production links beneath its name; Planning opens its source case, Production opens its execution overview. Unlinked cases keep their existing planning/create-case action and cannot pretend an execution project exists.
- Switching tabs does not create, release or modify records. Existing portfolio and pre-project APIs, permissions and release checks remain unchanged.
- Tabs use keyboard-accessible links and existing responsive/RTL navigation styles. Empty lists explain which lifecycle stage belongs there. An execution fetch failure remains visible so linked cases are not silently presented as a complete portfolio.
