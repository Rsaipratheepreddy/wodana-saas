# Backend module map — B0

This map fixes ownership boundaries for the backend-first UAT plan. Business Core is the only
system of record. Intelligence/Automation performs provider and background work through Business
Core commands and must not write business tables directly.

| Domain | Authoritative implementation | Public route family | Depends on |
| --- | --- | --- | --- |
| Identity and sessions | `services/business-core/src/auth` | `/auth`, `/me`, `/security` | Workspace identity, Redis sessions |
| Tenant and organization | `services/business-core/src/workspaces` | `/workspaces`, `/public/tenant-branding` | Identity, audit, email |
| Reference data | `services/business-core/src/reference` | `/reference` | Global reference tables |
| CRM | `services/business-core/src/crm` | `/workspaces/:workspaceId/crm` | Tenant access, eventing, email |
| Pre-execution | `services/business-core/src/pre-projects` | `/workspaces/:workspaceId/pre-projects` | CRM opportunity, catalog, file storage |
| Catalog and master data | `services/business-core/src/catalog` | `/workspaces/:workspaceId/catalog` | Tenant access, audit |
| Commercial | `services/business-core/src/commercial` | `/workspaces/:workspaceId/commercial`, `/client-portal/:slug` | Pre-execution, catalog, portal access |
| Delivery projects | `services/business-core/src/projects` | `/workspaces/:workspaceId/projects`, including `/portfolio`, `/calendar`, and `/:projectId/files` | Accepted commercial release, HRMS, catalog |
| People and attendance | `services/business-core/src/hrms` | `/workspaces/:workspaceId/hrms` | Tenant access, project assignments |
| Connection registry | `services/business-core/src/integrations` | `/workspaces/:workspaceId/integration-connections` | Tenant access, encrypted secret references |
| Provider execution | `services/intelligence-automation` | `/api/v1/integrations`, worker queue | Business Core commands, Redis, provider APIs |
| Audit and background events | `services/business-core/src/eventing` | Internal | All write domains, outbox worker |
| Health | Both backend services | `/health` | Database, Redis and configured dependencies |

## Permission families

- Workspace administration: `workspace.*`, `legal_entities.*`, `finance.settings.manage`.
- Module administration: `module.organization.*`, `module.members.*`, `module.roles.*`,
  `module.teams.*`, `module.integrations.*`.
- CRM: `crm.parties.*`, `crm.leads.*`, `crm.activities.*`, `crm.communications.*`,
  `crm.opportunities.*`, `crm.automations.*`, `crm.notifications.*`, `crm.reports.view`,
  `crm.settings.manage`, `crm.consent.manage`, `crm.privacy.erase`.
- Preparation and design: `pre_projects.*`, including separate design review, client decision,
  and measurement verification grants.
- Commercial and portal: `commercial.approve`, `commercial.release`, `portal.manage`.
- Projects: `projects.view`, `projects.manage`, `projects.report`, `projects.review`, `projects.buy`.
- Catalog: `catalog.view`, `catalog.manage`.
- HRMS: `hrms.self`, `hrms.team`, `hrms.manage`, `hrms.evidence`.
- Integrations and audit: `integrations.view`, `integrations.manage`, `audit.view`.

## Dependency direction

```text
Tenant/Auth
  -> Configuration/Catalog
  -> CRM
  -> Pre-execution
  -> Commercial approval
  -> Delivery project
  -> Procurement/Production/Site/Handover

Eventing, files, notifications and integrations support the flow without becoming
independent systems of record.
```

New modules must respect this direction. In particular, provider workers and UI routes may not
create independently writable copies of CRM, quotation, project, or schedule state.
