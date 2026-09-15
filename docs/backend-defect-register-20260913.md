# Backend defect register — B0

This register separates known backend work from frontend redesign and production infrastructure.
Priority is based on the Palm Living UAT journey, while every fix must remain generic SaaS behavior.

| ID | Priority | Module | Finding | Target chunk | State |
| --- | --- | --- | --- | --- | --- |
| B0-001 | High | Test infrastructure | Integration configuration tests inherited optional provider credentials from the developer environment. | B0 | Resolved |
| B0-002 | High | Database migrations | An unjournaled historical `0023` file was not documented or protected against future unregistered migrations. Migration 0032 already handles the compatible schema creation. | B0 | Resolved with manifest guard |
| B0-003 | High | Database migrations | Latest migrations required rehearsal against an isolated existing-installation snapshot. | B0 | Resolved; 53-record historical schema accepted |
| B0-004 | High | Runtime | Authenticated, provider-disabled HTTP smoke journeys needed one repeatable isolated run. | B0 | Resolved; 15 safeguards passed |
| B1-001 | High | Memberships | Subscription seat usage was displayed but invitations did not enforce the seat limit. Directly created workspaces also lacked subscription rows. | B1 | Resolved; concurrent HTTP/database smoke passed |
| B1-002 | Medium for UAT | Authentication | Staff accounts did not have an MFA enrollment and challenge flow. | B1 / production gate | Resolved; backend safeguards and web challenge, enrollment, recovery, status and step-up flows verified locally |
| B1-003 | High | Tenant isolation | Special cross-tenant/public/worker tables required an explicit application-access and RLS review. | B1 | Resolved; five documented exceptions and schema assertion added |
| B2-001 | High | Organization configuration | Departments had no configurable color for portfolio scheduling. | B2 | Resolved; validated business-unit color API and additive migration |
| B2-002 | High | CRM configuration | New-tenant channel and budget fallbacks exposed Palm/PlyLeads names and AED-specific bands globally. | B2 | Resolved; neutral defaults plus non-destructive legacy preservation |
| B2-003 | High | Tenant configuration | System terminology was hard-coded, preventing tenants from using their own domain language. | N1/N2 | Resolved; default-first terminology registry, API, audit, RLS and compatibility aliases added |
| B2-004 | High | Tenant control | Separate organizations could not be grouped safely under one customer account with a controlled request and approval flow. | B2 | Resolved; default organization, account membership, limits, request review, independent provisioning, switch metadata and cross-account denial verified |
| B3-001 | High | Lead intake | Required-field behavior was not configurable enough: the public form required email and did not require enquiry type. | B3 | Resolved; per-form requiredness with name/contact safety invariant |
| B4-001 | High | Files | Files are stored across several modules without one authoritative project file index. | B4 | Resolved; tenant-scoped lifecycle index and unified download path added |
| B4-002 | High | Quotations | Saved quotation templates appeared missing to the client. | B4 | Backend verified; tenant-scoped list, read, save and prepare APIs already exist; frontend discoverability remains |
| B7-001 | High | Projects | The all-projects response did not expose calculated progress, task health, schedule movement, milestones, or file count. | B7 | Resolved; additive portfolio summaries are calculated by the backend |
| B8-001 | High | Scheduling | No portfolio endpoint combines confirmed bookings across projects and departments. | B8 | Resolved; bounded, filterable department calendar with overlap metadata added |
| B10-001 | Medium | QuickBooks | The current connection is degraded and must be repaired or excluded from UAT. | B10 | Pending |
| B10-002 | Medium | Google Calendar | CRM meeting creation does not currently create or update provider calendar events. | B10 | Pending scope decision |
| B11-001 | High | Data portability | Module exports exist, but a complete tenant export with original files does not. | B11 | Pending |

There are currently no confirmed critical defects in the isolated Business Core suite. Tenant
isolation, lead-flow, workspace, and portfolio-calendar HTTP checks have passed locally. Production
identity-provider production configuration, provider connections, complete tenant export, and infrastructure recovery remain separate
release gates and must not be represented as complete.
