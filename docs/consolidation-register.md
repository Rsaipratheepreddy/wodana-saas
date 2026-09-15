# Wodana consolidation register

This register prevents completed work from being lost while the product is consolidated into
`wodana-saas`. Status means the capability's state in this repository, not its state in a legacy
application.

| Capability | Wodana SaaS destination | Current status | Required consolidation work |
| --- | --- | --- | --- |
| Workspace provisioning and tenant administration | `services/business-core/src/workspaces`, `apps/web/app/internal` | Implemented | Verify production authorization, subscription controls, and audit coverage |
| Independent organizations under one customer account | `services/business-core/src/workspaces` | Implemented backend contract | Connect the later account switcher, tenant request form, and Wodana review UI to the verified APIs |
| Tenant-configurable terminology with safe defaults | `services/business-core/src/workspaces`, web workspace bootstrap | Implemented | Apply resolved labels consistently across remaining web navigation and forms |
| MFA/TOTP, recovery codes, and step-up authentication | `services/business-core/src/auth`, web authentication/settings | Implemented | Complete browser UAT with real authenticator apps and configure a new production encryption key before deployment |
| Tenant portfolio overview and department calendar | `services/business-core/src/projects`, project workspace UI | Partial | Connect complete booking CRUD, capacity, overlap/gap summaries, filters, and tenant colors |
| CRM acquisition taxonomy and duplicate lifecycle | `services/business-core/src/crm` | Partial | Verify and complete source, channel, intake, assignment, duplicate linkage, routing, SLA, and reporting |
| Requirements, design, catalog, and quotation lineage | `pre-projects`, `catalog`, `commercial`, `projects` | Implemented backend contract | Accepted project and variation snapshots retain source/specification/catalog versions, reject price-hash drift, and pass the API funnel proof; connect and simplify the later UI |
| Owner Review and Deal File release | `commercial` | Implemented and API-verified | Two-owner review, accepted hash, Deal File identity, release and retry behavior pass the disposable full-funnel smoke |
| Generic project workflow and tenant stage configuration | `projects` | Partial — template contract implemented | Tenant-isolated templates, visible stage names, role ownership, bounded gates, versions, audit and safe fallback are API-verified; next freeze the selected template on each project and add controlled transition history while preserving the independent on-hold overlay |
| Procurement, manufacturing, site, installation, QC, and snagging | `projects`, future bounded modules | Partial | Close operational gaps without introducing a second procurement source of truth |
| Quotation templates | `commercial`, web quotation workspace | Implemented | Verify permissions and make templates easy to find in the final navigation |
| Unified project files and document history | `pre-projects`, `projects`, object storage | Partial | Provide one permission-aware folder experience across pre-project and delivery records |
| Handover, warranty, service, and closure | `projects` | Partial | Complete warranty/service records, closure gates, documents, and reporting |
| Tenant onboarding and assisted data migration | `workspaces`, `intelligence-automation` | Deferred | Implement after the operational funnel is stable, with preview, validation, rollback, and audit |

## Locked delivery order

1. Repository and contract baseline.
2. Tenant control, organization model, terminology, and MFA.
3. CRM intake, validation, duplicate handling, assignment, and qualification.
4. Requirements, design, catalog, quotation, acceptance, Owner Review, and Deal File.
5. Generic project workflow and commercial-to-project conversion.
6. Planning, portfolio calendar, procurement, production, site, installation, and quality.
7. Files, handover, warranty, closure, reporting, and audit.
8. Web and mobile integration/cleanup after backend contracts are stable.
9. Migration rehearsal, UAT, rollback rehearsal, and release approval.

Each item is delivered as a small vertical verification unit: schema/migration, service/API,
focused tests, affected full-suite regression, and an updated register entry.
