# Factory capacity connection

Local slice: Factory → Capacity reads the existing authorized schedule availability service. Show resource, timezone, working shift, configured capacity, confirmed, tentative and remaining units. Remaining excludes tentative holds; it is an availability view, not a booking guarantee or count of finished pieces. Closed calendars have no working slots. Resource/project details stay within existing backend visibility rules.

Date filters use a bounded range; loading/error/retry states never imply free capacity. Project task booking remains an explicit action with shift and capacity units. Pooled resources accept requested units; exclusive resources use one. Backend confirmation rechecks cross-project overlap and calendars. No shared production-run entity is added by this slice.

## Implemented

- `apps/web/app/api/project-capacity/route.ts`: authenticated read proxy with valid dates, optional resource UUID and maximum 93-day date difference; does not forward arbitrary query parameters.
- `apps/web/components/projects/project-factory-capacity.tsx`: shared date fields and full-grid table, working-shift rows, resource search, loading/error/retry, and eligible current-project task actions. Missing shifts are not inferred to be free capacity. Backend visibility governs returned resources.
- `project-workspace.tsx`: Factory Capacity subview and deep link, shared booking dialog with pooled units and explicit task date range. Picking a shift row does not silently change task dates. Confirmation rechecks availability on the backend.
- Local checks: 7 new UI/proxy tests and 5 existing capacity regression tests pass; web typecheck and targeted new-file lint pass.
- Two synthetic browser checks pass (desktop/mobile): Capacity deep link, complete cell grid borders, LTR/RTL overflow and keyboard opening of the pooled booking dialog. No real project was changed. Browser checks exposed and fixed the view allowlist and inherited border overrides.

## Next boundary

Implement an actual shared factory run with per-project task allocations, frozen scope references, output/QC/rework/dispatch quantities and independent approval. Preserve quantity conservation and cross-project authorization under concurrent writes. This capacity view is not that run entity. Full 30-section acceptance, finance depth, portal lifecycle and end-to-end scenario verification remain outstanding; no production activation was performed.
