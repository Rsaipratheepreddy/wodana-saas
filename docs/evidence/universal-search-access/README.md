# P01.5 universal search and access — local acceptance evidence

Accepted locally on 18 September 2026. No Palm production data, invitation, provider, domain or deployment was touched.

## Product boundary

- `GET /workspaces/:workspaceId/search` searches only record kinds the current active member can read: Customer, Job, Room, Quotation and Project.
- Effective permissions come from `effective_member_roles`, so an active team role behaves exactly like a direct role. Project and Project-backed Job results also retain the existing active-assignment restriction for non-managers.
- Results carry a stable type, title, context, reference and canonical route. Search never returns a hidden kind in either `items` or `searchedKinds`.
- Quotation results include only identifiable `kind=quotation` entries; variations cannot be mislabeled as quotations.
- Room result links select the intended Room on the requirements screen. Search changes on the same case remount the filtered requirements view without copying room state.
- The sidebar composes the shared `SearchInput`, `Badge`, `Button` and `Skeleton`; its result panel is keyboard reachable, bounded inside the sidebar and closes through the shared search control.

## Palm two-role and seat acceptance

`npm run test:smoke:palm-fixture` was strengthened so the synthetic Cece actor receives **no direct role**. Operations creates a UAT Review team, grants the reviewer role to that team, invites Cece with `roleCodes: []` and `teamIds: [teamId]`, then accepts the invitation.

The disposable migrated-database run asserted:

- seat usage moved from `1 active + 0 pending = 1 reserved`, to `1 + 1 = 2`, then `2 + 0 = 2`; acceptance did not consume a second reservation;
- Cece's direct role list remained empty while `uat_reviewer` appeared in `inheritedRoles` and the team membership was materialized;
- Operations search returned Customer, Job, Room, Quotation and Project;
- Cece search returned only Job, Room and Quotation, including the exact synthetic room and quotation;
- a Project execution link was denied to Cece while the permitted pre-execution link opened;
- archiving the team immediately removed every Cece search result and denied previously reachable Job and pre-execution links; and
- the shell trap removed the exact disposable database after the run.

## Verification

```text
npm test --workspace @wodana/business-core -- --run src/search/workspace-search.service.spec.ts
1 file passed; 5 tests passed

npm test --workspace @wodana/web -- --run components/workspace/workspace-sidebar.test.tsx components/pre-project/scope-note-cards.test.tsx app/api/workspace/search/route.test.ts
3 files passed; 33 tests passed

npm run typecheck --workspace @wodana/business-core
PASS

npm run typecheck --workspace @wodana/web
PASS

npm run test:smoke:palm-fixture
PASS — isolated Palm synthetic enquiry → project funnel plus inherited search/access/seat assertions

Changed web files ESLint
PASS
```

Browser acceptance used the local synthetic application at `127.0.0.1:3100`:

- desktop light and dark rendered the bounded search panel with meaningful type badges, references and complete panel separators;
- the Room result navigated to the canonical requirements route and the Room selector showed **Reception**;
- a headless 390 × 844 dark-mode run returned four matching records, kept the panel fully inside the viewport and reported `scrollWidth === innerWidth === 390`; and
- the native browser cancel decoration was removed inside the shared `SearchInput`, leaving one accessible clear control.

## Remaining release boundary

This is local search/access acceptance, not Palm live readiness. Real Palm people and teams, clone migration, provider delivery, physical devices and deployment remain P09 gates. Regional finance compliance remains the explicit P06.3 external acceptance gate.
