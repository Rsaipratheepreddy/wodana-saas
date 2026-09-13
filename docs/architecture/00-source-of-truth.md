# Wodana source of truth

`wodana-saas` is the only active product repository for Wodana.

## Active runtime

| Product area | Canonical path | Responsibility |
| --- | --- | --- |
| Web application | `apps/web` | Internal workspace, portals, administration, and public intake |
| Mobile application | `apps/mobile` | Staff field application |
| Business system of record | `services/business-core` | Tenant-isolated business data, commands, permissions, audit, and workflow gates |
| Intelligence and integrations | `services/intelligence-automation` | AI, document processing, provider adapters, and background work |
| Shared contracts | `packages/contracts` | Versioned API and event contracts shared across services |
| Runtime and release | `compose.yaml`, `infra`, `.github/workflows` | Local composition, production runbooks, and quality gates |

Business Core is the only service allowed to write authoritative business tables. The web, mobile,
and intelligence services must use authenticated Business Core commands and contracts.

## Legacy sources

The parent `Igolo-Management-main` FastAPI application and the adjacent `Wodana-Frontend`
application are migration references only. They must not receive new product work. A feature found in
those sources is not considered shipped until it has been implemented and verified in this repository.

Legacy code must be selectively ported by business capability, not copied as a second runtime. Every
port must preserve tenant isolation, permissions, audit events, idempotency, and migration safety.

## Consolidation rule

For each legacy capability:

1. Record the capability and its Wodana SaaS destination in `docs/consolidation-register.md`.
2. Confirm whether an equivalent already exists here.
3. Implement only the missing behavior through Business Core and shared contracts.
4. Add focused tests and run the full affected workspace suite.
5. Mark the register entry verified only after the API and consumer are connected.

Do not deploy or retire legacy data until migration, rollback, and UAT evidence are complete.
