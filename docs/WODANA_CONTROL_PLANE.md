# Wodana internal control plane

**Status:** target design plus verified local baseline; not a production-readiness claim
**Updated:** 17 September 2026
**Execution:** [WODANA_TASKS.md](WODANA_TASKS.md)
**Product context:** [WODANA_PRODUCT_BLUEPRINT.md](WODANA_PRODUCT_BLUEPRINT.md)

The internal portal is Wodana's own control plane. It is not a tenant workspace, CRM module, or a page in the staff mobile app. Its job is to provision and safely operate customer accounts and their organizations, with clear commercial entitlements and an auditable route from invitation to live use. Tenant web and mobile apps consume the resulting access, branding, domain and module state; they do not edit platform contracts.

## 1. Terms and ownership

```text
Wodana platform
  └─ Customer account: contract, billing contact, organization allowance, support relationship
       └─ Organization / workspace: tenant-isolated data, subdomain, kit, users, teams, plan allocation
            ├─ Legal entities and branches: document issuer, tax/currency, operating unit
            └─ Members: direct + team-inherited roles, seat reservation, module permissions
```

Use **customer account** for the commercial relationship and **organization** for an isolated workspace. The code's `tenant` currently names an organization; preserve API compatibility while making UI language unambiguous. One customer may own several organizations. A legal entity is not a separate login/data silo, and a team is not an extra seat. A person can belong to several organizations; seat accounting is per contracted allocation until an account-wide seat model is explicitly approved.

Business Core owns account, organization, entitlement, domain, invitation, seat, billing and audit records. The web internal portal is a server-side authenticated operator client. Workers handle certificate, email and billing-provider jobs through idempotent commands/events; they do not update Business Core tables directly. The mobile app reads effective tenant configuration from Business Core and never becomes a second internal administration console.

## 2. Operator experience

The portal's global list answers: **Which customers need action? Which are at risk? What changed?** Use a searchable shared DataGrid with account, organization count, owner, onboarding state, domain, plan/seat utilization, billing state and last activity. Filters are status, trial ending, invitation pending, domain issue, over-limit and failed provider delivery. No marketing KPI cards or a raw list of integrations as a proxy for health.

An account detail has five compact sections: **Overview, Organizations, Access, Domains & branding, Billing**, plus a chronological **Activity** view. The Overview shows one next action and readiness checklist. Each organization opens its own focused profile; do not mix account-level invoices with organization-level members on one edit form. Changes use inline editing or a concise drawer with a review step for high-impact actions. Domain and billing status show real evidence, never a decorative green badge.

The default onboarding journey is:

1. Create customer account with legal/billing contact and first organization name, slug, region and firm kit. Reserve the slug and choose a versioned plan with trial/seat/module allowances before issuing access.
2. Idempotently provision account, organization, owner role, first legal entity, defaults and audit record. If delivery fails, show whether creation succeeded and allow safe resume; never make a duplicate account.
3. Send an owner invitation through a configured channel. Show queued/sent/delivered/failed/accepted/expired separately. Rotate a lost/expired token and invalidate the old one; never store or re-display its plaintext.
4. Owner completes verified sign-in/MFA and the tenant's minimal company/team setup. The control plane shows step owner, completion evidence and failures without exposing private credentials.
5. Configure domain/branding, team access, permitted modules and integrations; run a synthetic UAT checklist. An authorized operator approves activation. Later changes use version checks and an audit diff.

No operator should need to retype the same company, country, currency or owner in another tab. A tenant may stay in trial while setup is incomplete; activation and subscription are distinct states.

## 3. Lifecycle and effects

Track account, organization, onboarding and commercial status separately. Do not treat a `past_due` billing label as a permission check or `suspended` organization as a deleted customer.

| State/operation | Required behavior |
| --- | --- |
| Draft/provisioning | Reserved identity; idempotent retry; no member sign-in before organization and owner invitation are committed. |
| Trial/active | Effective modules, seats, projects and integration capabilities come from versioned entitlements, intersected with member permissions. |
| Grace/past due | Explicit dated policy: warning and finance follow-up first; state the exact features affected. Never silently hide existing data. |
| Suspended | Block tenant operational commands and sign-in as defined by policy; preserve data, audit, billing and controlled export/support access. |
| Reactivated | Re-evaluate entitlements, seats, domain/certificate and sessions before reopening; preserve history. |
| Archived/closed | Retention/export and contract closeout recorded; irreversible erasure is a separate approved process with legal holds. |

The first implementation must specify a state-transition table and test each effect in Business Core, web, client links and mobile. A change to plan or suspension is not complete when only an admin form saves.

## 4. Access, seats and module entitlement

There are three independent layers:

1. **Platform operator role:** provisioner, account/billing operator, support observer, domain operator and platform security owner. The current single `administrator` is a temporary coarse role. Sensitive changes need least privilege, MFA step-up where warranted, and a second approver for exceptional support access or irreversible operations.
2. **Commercial entitlement:** account contract and organization allocation grant modules, limits and capabilities. Version the plan catalogue and tenant overrides with effective dates and a reason. A feature flag for unfinished code is separate from a sold entitlement.
3. **Tenant permission:** organization membership and direct/team-inherited role grants decide what an entitled person can do, then legal-entity/branch/record scope narrows it further. Effective access is the intersection, never the union, of entitlement and permission.

Seats count active members plus non-expired pending invitations and any other reserved invitation state exactly once per person/organization. Display **used/reserved/available** rather than only active members. Expiration, cancellation and offboarding release a reservation; acceptance converts a reservation into a member without transiently consuming two seats. Concurrent invite/accept/limit changes lock the same capacity boundary. Over-limit reductions fail with actionable counts; grandfathering, contractors/service identities and account-wide pooling require explicit policy, not accidental bypass.

Internal operators may inspect effective access and its source (plan, direct role, inherited team, scope) but must not silently edit a tenant's team membership on behalf of the owner. Tenant admins manage teams and roles within purchased modules. A support session is time-boxed, consented or policy-approved, visibly bannered, read-only by default and fully attributed.

## 5. Domain and branding

- Reserve `{slug}.wodana.ai` at provisioning; validate collisions and reserved names. A slug change is a migration with redirects/link update, never a casual text edit.
- A custom domain begins `requested`, receives a unique expiring DNS ownership challenge, then becomes `verified`. Only then start routing and TLS certificate issuance. Expose DNS, certificate and routing checks separately, with timestamps, retry and safe rollback; never mark a domain live because it was typed into a form.
- Bind a verified hostname to one active organization; prevent domain takeover on removal, expiry, account transfer or stale DNS. Validate Host headers and auth callback/redirect origins. Use the active verified domain for sign-in, invitations, public forms and client links, with the Wodana subdomain as safe fallback.
- Wodana centrally configures tenant logo, approved accent, light/dark contrast and email/PDF identity. Customers cannot edit protected brand colour in their workspace. Store original and optimized assets, avoid broad gradients, and test login/onboarding/mobile visual parity.
- Domain DNS/TLS automation is an infrastructure capability with provider receipts; if unavailable, show `manual setup required`, not `connected`.

## 6. Billing and commercial truth

The account owns the contract, billing contact, tax profile and invoices; organizations receive explicit allocations. Existing `workspace_subscriptions` can serve as a compatibility allocation during migration, but must not become a second independent contract. Define the migration and reconciliation before changing authority.

Version plan catalogue, quote/contract terms, seat/module/project/storage/AI allowances, start/renewal dates, currency and billing cycle. A manual price or custom contract must have approval and effective date. Usage is metered from authoritative events with a drill-down, not editable counters. Invoice, credit note, receipt/payment allocation and refund are structured records with immutable issue numbers and legal-entity/tax context; financial and tax rules need jurisdictional review. A payment-provider webhook is evidence to reconcile, not an unreviewed plan switch.

The operator can see invoice/collection state, trial expiry, grace dates, dunning attempts and the projected access consequence before taking action. Plan upgrade/downgrade, proration, seat change, cancellation and reactivation must preview next bill and affected modules, require confirmation, emit an audit event and be retry-safe. No customer-facing billing claim until actual invoice/payment delivery is verified. Payment credentials stay in a vault/provider, never in portal JSON.

## 7. API, audit and security contract

Use versioned internal commands/read models behind the existing server-side BFF. Required groups: account/organization provision and status; onboarding and invitation delivery; domains/verification/certificates; platform roles/support sessions; seat/role/team access summary; plans/entitlements/usage; invoices/credits/receipts; account activity and export. Each mutation carries a stable idempotency key where retried, expected version, operator identity, reason and correlation ID; responses include effective state and whether downstream work is pending. Long-running jobs use explicit `queued/running/succeeded/failed` state.

The BFF checks the authenticated operator, origin/CSRF and route policy. Business Core independently verifies the operator assertion and action scope rather than trusting only a shared service token. Audit records must identify the human operator; current internal subscription updates record a null actor, which is insufficient for the target. Redact tokens, billing secrets, private notes and personal data from logs and list payloads. Test cross-tenant reads and writes, forged hostnames, stale versions, replay, concurrent seats, provider failure and suspended-tenant behavior. Support access is not ordinary impersonation.

## 8. Local baseline verified on 17 September 2026

| Capability | Current evidence | Status/gap |
| --- | --- | --- |
| Tenant provisioning | `InternalTenantsController`, `WorkspacesService.provisionTenant`, idempotency hash/lock, owner invitation, first legal entity/account/subscription | API exists; portal creates one organization and displays a copyable activation link. Delivery/activation readiness is not a full workflow. The read-only `/internal/tenants/:id/status` API exposes honest seat/domain/entitlement status and passed a database-backed local HTTP smoke. |
| Internal web | `apps/web/app/internal/portal.tsx`, dedicated operator sign-in/session and internal BFF proxy | Shared DataGrid and control components are present; the status view shows seat reservations and truthful capability gaps. Full account/organization navigation and capability-specific roles are still missing. The portal has no link to or from customer workspace navigation. |
| Customer accounts/organizations | `InternalOrganizationAccountsController`, `CustomerAccountsService` | Review/approval and limit APIs exist; not connected to the internal portal UI. |
| Seats/roles/teams | One authoritative transactional seat-capacity function; direct/team-inherited roles; entitlement-filtered effective-access explanation | CP03.1 passed locally, including concurrent invitation/accept/reactivation/cancellation behavior and scoped operator inspection. Compact portal explanation and tenant web/native acceptance remain CP03.2–CP03.3. |
| Modules | Tenant `module.*` permissions and various domain permissions | Tenant RBAC exists; plan-to-module entitlements and enforcement are not established. |
| Domain/brand | `tenantSlugFromHost`, `tenant_login_branding`, tenant logo and colour | Wodana subdomain/login brand exists. No custom-domain request, ownership, TLS or routing lifecycle. |
| Billing | `workspace_subscriptions` with plan/status/cycle/amount/seat/project limits | Manual subscription terms only. No account-level contract/invoice/payment/dunning truth or demonstrated status enforcement. |
| Platform access/audit | Scoped platform roles; separate operator password/MFA/session; service-plus-operator and fail-closed permission guards; human-attributed tenant/platform audit | CP03.1 passed locally for provisioning, billing, domains, invitations, entitlements, support and data commands. Production operator setup and UI capability presentation remain gated. Existing `/internal/tenants/*` routes remain service-only machine APIs. |
| Mobile | Staff Expo app consumes tenant auth/workflow APIs | No internal admin UI by design; CP00.6 locally verified active/suspended organization, selected brand and role-granted working module cards. Device runtime, commercial entitlement and domain-link effects remain unverified. |

Focused baseline tests passed locally: Business Core tenant management, seat-capacity and provisioning-idempotency specs (**3 files, 5 tests**), and internal portal UI spec (**1 file, 1 test**). The first status-API slice then passed Business Core/internal-guard specs (**4 files, 10 tests**), web BFF/portal specs (**2 files, 3 tests**) and both package typechecks. The local Business Core server on port 8131, backed by the existing local `wodana` PostgreSQL database, returned **200** for a known tenant, **401** without the internal credential and **404** for an unknown tenant; its seat calculation and absence of invitation tokens/private notes were asserted. This is an API smoke, not full operator-web acceptance, custom-domain verification or billing proof.

The portal UI slice compiled in the Next.js production build; focused web tests passed **4 files/25 tests** with typecheck and selected lint clean. Local synthetic previews showed the shared bordered table in light/dark desktop/mobile layouts and the header-only loading skeleton. Temporary preview routes were removed after inspection. The list and inspector have accessible empty, error and loading states, honest seat/invitation/domain status, and one next action. CP00.5 subsequently passed a local API→web operator/MFA/audit smoke and desktop/mobile light/dark sign-in tests; details are in [the operator auth report](WODANA_OPERATOR_AUTH.md). This is still not production or tenant-operation release acceptance.

## 9. Release gates

For each vertical slice, finish **Business Core contract and denial tests → internal web action and error states → tenant web/mobile effects → synthetic end-to-end UAT**. UI work first requires the shared component inventory in the task board. Internal administration is responsive web only; no Wodana-control tab is added to tenant mobile. The Palm test tenant is the first acceptance case, using synthetic data and only authorized tester accounts. No live domain, billing, invitation or production change follows from this document alone.

## 10. Tenant app-effect acceptance (CP00.6)

Business Core `/me` now returns active member organizations with their customer account, approved tenant brand and role-granted module IDs. Suspended/archived organizations remain in a separate unavailable summary, with no selectable tenant membership. This is a **permission summary**, not a commercial entitlement: CP04 must intersect sold capabilities with tenant permission and enforce that intersection in every API.

Tenant web selects an active organization, shows its operator-approved brand and available navigation, blocks direct workspace routes without the selected organization's module grant, and renders unavailable organizations as non-interactive entries. The denial page is outside the workspace shell. The internal operator portal remains separate. Native sign-in/restore fails closed without an active selected organization and grant summary; Home shows only granted modules that have a working native destination. The selected organization's name, account and logo/approved colour appear on native Home, with a safe fallback when its relative logo origin is not configured. Projects is not a native card until its destination exists.

Local evidence on 17 September 2026: Business Core focused Vitest **2 files/3 tests**; web focused Vitest **4 files/17 tests**, typecheck and production build; native **42/42 tests**, typecheck and iOS/Android JavaScript exports. `APP_EFFECTS_TEST_DATABASE_URL=... BUSINESS_CORE_URL=http://127.0.0.1:8022/api/v1 node services/business-core/scripts/smoke-tenant-app-effects.mjs` used only a loopback API/local database. It created two organizations in one synthetic account with distinct role grants/brand and a third foreign-account organization, then verified own reads, a foreign 404, suspended removal from the selectable list, suspended read 404 and suspended login 401. Exact-ID cleanup and audit-trigger restoration were asserted. `git diff --check` passed. No Palm or deployed data was changed. Native on-device runtime, full visual review and commercial entitlement enforcement are separate release gates, not claimed by this slice.
