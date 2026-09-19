# P01.3 Job web shell — local acceptance evidence

Accepted locally on 18 September 2026. No production, Palm tenant or provider state was changed.

## Product boundary

- `/workspace/crm` is an action-only **Today** queue. It shows Jobs that have a next action or an explicit blocked, awaiting-client or at-risk flag; it is not another CRM dashboard.
- `/workspace/crm/jobs` is the stable Job record spine. It shows the customer/Job identity, canonical reference, evidence-derived phase, owner, promise, risk and next action.
- `/workspace/crm/jobs/[jobId]` is the contextual Job profile. It shows the derived phase, audited manual stage, next action, operating state, source-owned linked records and permission-filtered timeline without copying source truth.
- Existing `/workspace/jobs` and `/workspace/jobs/[jobId]` links return `307` redirects to the CRM Job routes.
- The web read layer consumes the P01.1–P01.2 Business Core Job contracts. The local end-to-end bypass uses clearly synthetic fixtures only.

## Shared component compliance

Feature UI composes the existing `PageHeader`, `Container`, `Stack`, `Grid`, `Surface`, `Button`, `Badge`, `Avatar`, `Callout`, `EmptyState`, `PropertyRow`, `StageTracker`, `ActivityFeed` and bordered `DataGrid` components. List and linked-record views use the shared `DataGrid` column-definition pattern, saved views, search, sorting, column controls, filter affordance, export, empty state and responsive column behavior.

The required raw-element audit was empty for `table`, `button`, `input`, `select` and `dialog` in the new feature routes/components. The duplicate-component-name audit was also empty. No component was forked into a feature-local substitute.

## Verification

Automated checks:

```text
npm run typecheck --workspace @wodana/web
PASS

npm test --workspace @wodana/web -- --run components/jobs/jobs.test.tsx components/workspace/workspace-sidebar.test.tsx
2 files passed; 11 tests passed

npx eslint components/jobs components/workspace/workspace-navigation.ts components/workspace/workspace-sidebar.test.tsx 'app/workspace/[[...section]]/page.tsx' app/workspace/crm/jobs app/workspace/jobs lib/jobs --quiet
PASS

git diff --check -- <P01.3 touched paths>
PASS
```

Browser acceptance used the running local web application at `127.0.0.1:3100` with the synthetic Job fixture:

- desktop light: Today, Jobs and Job profile rendered with complete outer/table-cell borders and no page-level overflow;
- desktop dark: Today and Job profile retained contrast, borders and readable state badges;
- 390 × 844 light/dark: Today, Jobs and Job profile had `scrollWidth === clientWidth === 390`; dense DataGrid content remained inside its own bounded scroll area;
- Job profile breadcrumb resolved to **Jobs** on the dynamic route;
- all six linked source records opened through source-specific routes;
- old list/detail paths returned `307` with the expected new location.

The dev console recorded one Next/Turbopack component-performance timestamp warning after repeated hot reloads. It originated in Next's development instrumentation, did not recur as an application error, and did not affect rendering or navigation. Touched-file lint, typecheck and focused tests passed. Full-repository lint remains separately blocked by pre-existing errors outside this slice.

## Remaining release boundary

This accepts the local P01.3 web slice, not a production release. Palm clone migration, real provider delivery, physical-device UAT and deployment remain P09 gates. Universal cross-domain search and the two-role denied-link traversal are P01.5.
