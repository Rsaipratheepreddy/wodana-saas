# CP04.1 commercial entitlement acceptance

Verified locally on 18 September 2026 with disposable synthetic accounts and organizations. No Palm Living data, provider, invitation or deployment was changed.

## Accepted contract

- The existing immutable `tenant_setup_profiles(kind='plan')` rows remain the versioned plan catalogue. A customer account contract is the commercial authority for plan code/version, seats and project limits.
- `account_entitlement_versions` records the sold module and limit snapshot, effective dates, operator reason and whether a legacy plan without module metadata required an explicit commercial override.
- `organization_entitlement_allocations` independently versions what an organization may use. It can allocate only modules and limits sold to its account.
- Future allocations remain scheduled until their start. Suspended or expired allocations preserve Workspace administration while removing product-module permission.
- `platform_capability_flags` versions unfinished product availability independently from anything sold to a customer. Marking a feature preview or unavailable does not silently rewrite customer allocations.
- `effective_workspace_entitlements` is the single read projection. Legacy mutable entitlement rows remain only as a compatibility projection/fallback during migration.

## Enforcement

Business Core now applies `sold entitlement ∩ effective direct/team role permission ∩ record scope` before work executes:

- `/me` and tenant navigation summaries use the effective projection.
- `WorkspaceAccessService` filters every permission request through the allocation.
- Projects and HRMS filter their shared permission context before assigned-project/team/employee record scope.
- Universal search removes unsold module permissions before selecting record kinds.
- Operator tenant status and access summaries report the same effective allocation.

The legacy behavior is intentionally retained only when an organization has never received any entitlement configuration; this prevents an unsafe surprise lockout during migration. Once an allocation exists, all later states fail closed.

## Automated evidence

- Full Business Core suite: 151 files passed, 1 skipped; 859 tests passed, 10 skipped.
- Business Core typecheck and production build passed.
- Focused entitlement, operator-policy, HRMS-context and search tests passed 27/27 before the full run.
- Fresh disposable migration through `0107_commercial_entitlements.sql` passed the repository tenant-isolation verifier.
- Authenticated operator smoke passed account-contract matching, immutable versions, explicit legacy-plan override, scheduled future allocation without early activation, independent capability flag, audit history, export, clone and rollback.
- Authenticated tenant app-effect smoke proved that a CRM-only sold allocation removes Projects from `/me` and returns 403 from the real Projects workflow API even though team roles grant it; a new sold/allocation version restores both navigation and API access.
- Foreign-account reads, suspended organizations and revoked members remained denied.
- `git diff --check` passed after the full regression gate.

## Remaining work

- CP04.2 must present included, allocated and unavailable capability states with an exact before/after impact review using the shared operator components.
- CP04.3 must verify tenant web/mobile direct links and stale offline action denial across downgrade, suspension and restoration.
- Existing plan `starter` v1 predates module metadata. It is not silently redefined; allocations against it are visibly stored as `customOverride=true`. New commercial offerings require an approved new plan version.
- Palm clone/live validation, physical devices, providers and deployment remain P09 release gates.
