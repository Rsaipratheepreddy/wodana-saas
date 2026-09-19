# Main portal capability baseline — P00.1

**17 September 2026. Local code audit, not a release certificate.** The tenant-facing portal is now the priority. This records what the current routes actually connect to so redesign and integration work follows a single business flow rather than the presence of tabs. Status vocabulary: **working locally** = a synthetic API+consumer path has been exercised; **partially connected** = route, API and records exist but the cross-module/role path has not passed; **shell** = visible destination without a meaningful backing action; **unverified provider** = external connection/receipt not proven; **not present** = no product destination.

## Web route census and backing contract

The route patterns below cover the current tenant navigation and its dynamic pages. Query selectors and detail-section lists are stated explicitly; they are not separate Next route files. The source files are [navigation](../apps/web/components/workspace/workspace-navigation.ts), [workspace route](../apps/web/app/workspace/[[...section]]/page.tsx), [pre-execution sections](../apps/web/lib/pre-project/types.ts), [project sections](../apps/web/lib/projects/execution.ts) and [HRMS sections](../apps/web/lib/hrms/navigation.ts). All `/workspace/*` paths pass the web proxy's authenticated-membership, onboarding and allowed-module checks; Business Core still owns record-level permission enforcement.

| Portal route(s) | Business Core contract / source | Current evidence and status | Main gap |
| --- | --- | --- | --- |
| `/workspace`, `/workspace/language` | Workspace company profile, branding and terminology; `workspaces/*` | **Partially connected.** Company/terminology pages and mutation BFFs exist with focused tests. | Full owner/member and multi-organization save/readback, logo upload and locale UAT. |
| `/workspace/members`, `/workspace/roles`, `/workspace/teams` (teams hidden from sidebar) | `workspaces/*` membership, invitations, roles, teams; 0019/0077 team migrations | **Partially connected.** Invites, seats, roles and team records exist. | Team membership does not yet explain effective inherited access for every record/module; CP03/P01.5. |
| `/workspace/integrations` | Integration connections/resources and provider adapters | **Unverified provider.** Setup UI and connection records exist. | Actual capability and delivery receipts per provider; never infer “connected” from saved configuration. |
| `/workspace/settings/client-portal` | `commercial/portal-settings` | **Partially connected.** Separate settings page/API. | Verify published client identity/permissions against a client actor. |
| `/workspace/legal-entities`, `/workspace/billing`, `/workspace/organizations` (last hidden), `/workspace/settings/security`, `/workspace/settings/audit-logs` | Legal entities, subscriptions, customer accounts, local-auth security and audit APIs | **Partially connected.** Real routes/API exist. | Contract-level billing truth, team/seat impact and complete audit/privacy acceptance; CP03–CP06. |
| `/workspace/crm` | `crm/today`, priority projection | **Partially connected.** Today API and page exist. | One reconciled Job/Next Action projection and Palm two-role UAT. |
| `/workspace/crm/leads` plus `?section=forms`, `options`, `reports`, `sla`, `assignment` | `crm/leads`, public lead-forms, intake, settings, SLA/assignment policies; 0049/0062/0076 | **Working locally for a synthetic shared-form intake and lead readback; partially connected as a complete flow.** | Palm's eight types, approved form/routing, team inheritance, one-hour takeover, reconciled SLA/report and actual alert receipts. |
| `/workspace/crm/opportunities`, `/workspace/crm/customers`; hidden `/workspace/crm/organizations` redirects to customers | `crm/opportunities`, `crm/parties`, qualification | **Partially connected.** Record APIs/UI and versioned qualification exist. | End-to-end qualification → opportunity → Job/case, duplicates/reopen/merge and access. |
| `/workspace/crm/follow-ups`, `/workspace/crm/calendar`, `/workspace/crm/conversations`, `/workspace/crm/reports`; hidden `/workspace/crm/activities` redirects to follow-ups | Activities, conversations/messages, reporting, notifications | **Partially connected.** UI/API plus focused tests. | One accountable client timeline; external email/WhatsApp/push delivery is **unverified provider**, not a logged note. |
| `/workspace/pre-projects`, `/workspace/pre-projects/master-data`, `/workspace/pre-projects/catalogs`, `/workspace/pre-projects/quotation-templates` | Pre-project list/start, catalogue, commercial templates | **Partially connected.** Listing, master data, templates and server loaders exist. | Room/item identity, price provenance, role-scoped catalogue and quote handoff. |
| `/workspace/pre-projects/cases/[caseId]/{overview,requirements,measurements,inspiration,site-layouts,site,designs,definition,documents}` | Pre-project, case-content, site, assets, design/definition; 0022–0039/0068 | **Partially connected.** `measurements` and `site-layouts` redirect into requirements tabs. | One versioned Room/Item tree, field/offline evidence, revision-bound client decisions. |
| `/workspace/pre-projects/cases/[caseId]/{boq,quotations,contracts,payment-plan,variations,approvals,execution-release,client-portal}` and quotation print | `commercial/cases`, quote composer/templates, client portal, payments/release; 0035/0048/0074 | **Partially connected.** Commercial UI and many backend commands exist. | Room-first quote acceptance, verified money gates and controlled variation → project golden path. |
| `/workspace/projects`, `/workspace/projects/[projectId]/{overview,plan-teams,material-planning,procurement,production,site-work,daily-progress,snagging,handover,documents,commercial,boq}` | `projects/portfolio`, `projects/:id/execution`, planning, stock/files/vendor; 0040/0060/0061 | **Partially connected.** Portfolio and detail sections/API exist. | Released-quote evidence, procurement/factory/site quantities, field receipts, acceptance and rollback UAT. |
| `/workspace/hrms`, `/workspace/hrms/{attendance,leave,time-summary,site-attendance,team,people,settings,workplaces,leave-settings}` | `hrms/bootstrap`, attendance, leave, people/calendar; 0030 | **Partially connected.** Permissions scope sidebar groups. | Complete role/record scope, current-workspace and real attendance/device UAT. |
| `/enquiry/[token]`, `/portal/[slug]`, `/portal/[slug]/print` | Public form token; `client-portal/:slug` challenge/login/data/action | **Partially connected.** Branded synthetic form path was exercised; client portal API/page exists. | Client-safe full discovery/design/quote/decision/project path, provider proof and token/origin security. |

`/workspace/catalogs` is a legacy redirect/alias to pre-execution master data. `/workspace/crm/automations` and `/workspace/crm/sequences` redirect to CRM because technical workflow authoring is not a tenant task. Palm's pre-execution and Projects links are deliberately deferred by `WODANA_CRM_ONLY_WORKSPACE_SLUGS`; this is a release gate, not an absence of code. Direct links are checked by the web proxy. See [module rollout](../apps/web/lib/workspace/module-rollout.ts).

## Native mobile and background work

| Destination | Backing path | Current status and gap |
| --- | --- | --- |
| Login, MFA, organization selection and home | Native auth client + Business Core auth/`/me` | **Working locally** for a synthetic tenant/session; physical iOS/Android UAT still open. |
| CRM Today, Enquiries, Deals, Inbox and More | Native CRM client and the same Business Core CRM records | **Partially connected.** No verified Palm two-person, one-hour takeover or real provider notification. |
| Pre-project brief, room requirements, site visits/measurements/photos | Native pre-project API and Business Core case/site records | **Partially connected.** Offline/conflict/resumable media and accepted revision handoff are open. |
| HRMS attendance and leave | Native HRMS API and Business Core HRMS records | **Partially connected.** Real-device location/photo permission and role testing are open. |
| Project field execution, receipts, snags and handover | No native Projects home destination | **Not present** as a complete field workflow; P08/P09. |

The intelligence worker has a due-CRM-work loop, while Business Core has internal due-SLA/takeover endpoints. Presence of the loop or an outbox event is **not** an email, WhatsApp or push delivery receipt. Certificate/domain work is deferred per the current priority change.

## Permission, migration and test anchors

The web proxy checks the selected membership, onboarding state and role-derived module list before tenant routes; [the module grant calculation](../services/business-core/src/auth/module-access.ts) is explicitly a **role grant**, not a purchased-module entitlement. Business Core command guards and record scope remain the authority, so route visibility alone is never access proof.

| Family | Database / worker anchor | Existing automated evidence | What the test does **not** prove |
| --- | --- | --- | --- |
| Workspace, sign-in, seats and teams | Workspace membership/invitation and 0077 team access; local-auth/session/MFA | `workspaces.onboarding.spec.ts`, `workspaces.seat-capacity.spec.ts`, `auth/module-access.spec.ts`, `apps/mobile/scripts/auth-client.test.ts` | Team-inherited record access and a real email receipt. |
| CRM intake, ownership, response and qualification | CRM tables and 0076 unanswered ownership; due-work intelligence worker | `crm-intake.integrity.spec.ts`, `crm-leads.takeover.spec.ts`, `crm-leads.sla-accountability.spec.ts`, `crm-opportunities.conversion-integrity.spec.ts`, `apps/web/e2e/crm-flow.spec.ts` | Palm's two-role, weekend/one-hour duty policy or external message delivery. |
| Pre-execution, design and commercial | Case/definition/quote migrations 0022–0039, 0048 and 0074 | `pre-project-definition.service.spec.ts`, `design.service.spec.ts`, `commercial/client-portal-purpose.spec.ts`, `apps/web/e2e/pre-project-navigation.spec.ts` | Every room/item lineage and revision-bound client decision in browser/mobile. |
| Projects | Project execution/portfolio migrations 0040, 0060–0061 | `project-release.spec.ts`, `project-schedule-capacity.spec.ts`, `project-handover.spec.ts`, `apps/web/e2e/projects-navigation.spec.ts` | Native field receipts, offline evidence or full handover UAT. |
| HRMS | HRMS schema 0030, permission/record scope in HRMS access service | `hrms-domain.spec.ts`, `apps/web/e2e/hrms-flows.spec.ts`, `apps/mobile/scripts/hrms-queue.test.ts` | Real-device attendance and all manager/member scope combinations. |
| Client/public routes | Public lead form and client-portal challenge/action services | `lead-forms.public-branding.spec.ts`, `client-portal-purpose.spec.ts`, `apps/web/e2e/design-workspace.spec.ts` | Real client verification and delivery through a configured provider. |

## Reproducible local baseline, 17 September 2026

Both commands used `scripts/smoke-funnel-isolated.sh`, which created and dropped a random disposable local PostgreSQL database and ran on loopback. They did **not** use Palm live data, providers or deployment. The first run stopped at the isolation inventory because `tenant_provisioning_drafts` was missing from the explicit non-RLS exception list. Its table can precede a workspace and is accessed only through an internal-token plus platform-operator guarded controller; the inventory was corrected, leaving new unknown exceptions fail-closed.

| Command | Result | Measurable synthetic outcome |
| --- | --- | --- |
| `SMOKE_COMMAND=test:smoke:auth-web bash scripts/smoke-funnel-isolated.sh` | **Pass** after the inventory correction. | One invitation, onboarding UI, workspace UI, CRM create/readback, branded shared form and social-channel routing path. |
| `SMOKE_COMMAND=test:smoke bash scripts/smoke-funnel-isolated.sh` | **Pass**. | Three synthetic workspace members, 42 audit events and 19 reported safeguards including authentication, RBAC, optimistic locking, tenant isolation, cross-reference denial and concurrent last-owner protection. |
| `SMOKE_COMMAND=test:smoke:funnel bash scripts/smoke-funnel-isolated.sh` | **Pass**. | One intake → enquiry → lead → opportunity → pre-execution case → accepted quote/deal file → project; 37 named integrity/replay/governance assertions reported true, including project scheduling conflict and concurrent-write checks. |
| `npm --prefix apps/mobile test` | **Pass, 46/46**. | Native client contract tests for MFA/session/module grants, CRM request proxy, pre-project capture and HRMS offline retry. These are not physical-device tests. |
| `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3180 npm run test:e2e --workspace @wodana/web -- e2e/hrms-flows.spec.ts` | **Pass, 10/10; 2 intentionally skipped on mobile.** | Mock-backed desktop/mobile HRMS leave, attendance retry, setup, navigation and theme behavior. A stale hard-coded purple assertion was replaced with a shared-token assertion; this does not prove live HRMS API access. |
| `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3180 npm run test:e2e --workspace @wodana/web -- e2e/design-workspace.spec.ts` | **Pass, 2/2.** | Mock-backed desktop/mobile design review, revision and portal-decision handoff UI. |
| `npm run test --workspace @wodana/web -- components/commercial/client-portal-definition.test.tsx components/commercial/client-portal-design.test.tsx`; `npm run test --workspace @wodana/business-core -- src/commercial/client-portal-purpose.spec.ts` | **Pass, 7/7 web and 2/2 API-domain tests.** | Exact-version OTP purpose/decision and viewer-denial rules at component/domain level, not a real client/provider session. |

These are path counts, not product adoption, response-time or delivery metrics. Provider receipts: **0 verified**. Palm actor UAT: **0 completed in this isolated run**. Native physical-device UAT: **0 completed**. HRMS/client integrated actor sessions and every deep-link screen still need acceptance coverage, so the capability matrix is not a release certificate.

### Local versus Palm live

| Environment | What this baseline actually establishes | Unverified or missing |
| --- | --- | --- |
| Disposable **local** tenant | The isolated browser/API path above, workspace permission denials, mobile client contracts and mock-backed HRMS/design/client component behavior. | Real outbound delivery, physical mobile, full HRMS/client API actor sessions and production readiness. |
| **Palm live** tenant | No live command, deployment or current-state probe was run for P00.1. A prior [release-gap audit](palm-crm-release-gap-audit-20260917.md) observed no configured sales queue, SLA, forms, qualification form or pipeline at that time. | Current live configuration and two-person Operations/Cece UAT must be rechecked before any release claim; code-level passing tests cannot stand in for that evidence. |

## Immediate product blockers revealed by this audit

1. There is no single Job identity/One Tree across enquiry, opportunity, pre-execution, quote and project. Related screens can exist while the handoff feels fragmented. P00.2 is next after this baseline is verified.
2. Palm's current live configuration was previously observed with no sales queue, SLA, forms, qualification form or pipeline; a code path cannot substitute for configuration and a two-role synthetic UAT. Do not alter Palm live for this audit.
3. Team records and per-user roles/queue membership are distinct today. Do not imply that adding someone to a team automatically grants all team access until inheritance and seat behavior are proven.
4. Provider connections, invoice/receipt truth, project field flow and native-device behavior need real receipts/evidence. Keep them partial/unverified rather than masking them with polished navigation.

## P00.1 boundary

This is the requested capability **inventory** with runnable local baseline evidence and explicit incomplete labels. It does not certify the whole product. The HRMS/client integrated actor sessions, physical mobile, provider receipts, Palm configuration, room/item lineage and release UAT are acceptance tasks in P01–P09, not reasons to confuse an inventory with delivery. No provider or Palm production write is part of this baseline.
