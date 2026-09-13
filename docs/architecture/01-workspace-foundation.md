# Workspace and organization foundation

This is the first production domain in the rebuilt Wodana platform. It is the control plane for every later CRM, design, BOQ, production, purchasing, finance, client-portal, and vendor-portal record.

## Ownership model

```text
User ──< Workspace membership >── Workspace
                                    ├── Legal entity (Palm Living)
                                    │   └── Business unit / studio
                                    ├── Legal entity (ODG)
                                    │   └── Business unit / studio
                                    ├── Roles ──< Permissions
                                    └── Integration connections
                                        ├── Google domain A
                                        ├── Google domain B
                                        ├── QuickBooks company
                                        └── WhatsApp account
```

A workspace is the collaboration boundary. A legal entity is the commercial and accounting boundary. This allows one Wodana account such as `operations@palmlivingae.com` to operate multiple sister companies while keeping their tax registrations, document numbering, base currencies, accounting connections, and reporting dimensions distinct.

## Implemented capabilities

- OIDC-compatible identity resolution, signed local development sessions, and explicit
  development headers for low-level smoke testing.
- Multiple workspaces per user and multiple legal entities per workspace.
- Global currency, locale, timezone, week-start, and metric/imperial/mixed settings.
- Workspace roles, permission grants, member suspension/reactivation, invitations,
  token rotation, cancellation, and invitation acceptance.
- Internal, idempotent tenant provisioning with a first-owner invitation.
- Durable, resumable onboarding state included in the authenticated bootstrap response.
- Multiple provider connections, including multiple Google Workspace domains in one Wodana workspace.
- Versioned workspace, company, studio, role, member, and integration writes so two
  administrators cannot silently overwrite one another.
- Dependency-safe company/studio archiving and last-active-owner protection,
  including concurrent administrator requests serialized per workspace.
- Keyset-paginated audit history for stable performance as activity grows.
- Append-only audit records and transactional outbox events for automation workers.
- Idempotency-key and webhook-inbox storage for later command and provider endpoints.
- PostgreSQL row-level security plus cross-workspace foreign-reference guards.

Provider OAuth and resource discovery are intentionally the next vertical slice. Connection records exist now, but no OAuth token is accepted or stored until the encrypted secret-store adapter is added.

## API surface

All routes are under `/api/v1`.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/auth/tenant/:loginSlug` | Load non-sensitive tenant co-branding for login |
| `POST` | `/auth/login` | Verify a tenant-scoped local credential and create a token session |
| `POST` | `/auth/invitations/activate` | Set the invited owner's password and activate membership |
| `POST` | `/auth/refresh` | Rotate the opaque refresh token and issue a new access token |
| `POST` | `/auth/logout` | Revoke the current refresh session |
| `POST` | `/auth/password/forgot` | Issue a non-enumerating password recovery request |
| `POST` | `/auth/password/reset` | Consume a one-time reset token and revoke existing sessions |
| `GET` | `/me` | Load the signed-in user, memberships, and roles |
| `POST` | `/workspaces` | Create workspace, first legal entity, owner membership, roles, and document sequences |
| `GET` | `/workspaces` | List the current user's workspaces |
| `GET` | `/workspaces/:id` | Read the organization structure |
| `PATCH` | `/workspaces/:id` | Update workspace name or slug with version checking |
| `PATCH` | `/workspaces/:id/settings` | Update regional settings with version checking |
| `POST` | `/workspaces/:id/legal-entities` | Add a sister company or operating company |
| `PATCH` | `/workspaces/:id/legal-entities/:entityId` | Update a legal entity |
| `POST` | `/workspaces/:id/legal-entities/:entityId/archive` | Archive an unused legal entity safely |
| `POST` | `/workspaces/:id/business-units` | Add a studio, branch, or department |
| `PATCH` | `/workspaces/:id/business-units/:unitId` | Update hierarchy, company, name, type, or timezone |
| `POST` | `/workspaces/:id/business-units/:unitId/archive` | Archive a business unit without active children |
| `GET/POST` | `/workspaces/:id/roles` | List or create custom roles |
| `PATCH/DELETE` | `/workspaces/:id/roles/:roleId` | Update or safely delete a custom role |
| `GET` | `/workspaces/:id/members` | List members and assigned roles |
| `PATCH` | `/workspaces/:id/members/:membershipId` | Change roles or suspend/reactivate a member |
| `POST` | `/workspaces/:id/invitations` | Invite a member with roles |
| `GET` | `/workspaces/:id/invitations` | List active and historical invitations |
| `POST` | `/workspaces/:id/invitations/:invitationId/resend` | Rotate an invitation token and expiry |
| `DELETE` | `/workspaces/:id/invitations/:invitationId` | Cancel a pending invitation |
| `POST` | `/workspaces/invitations/accept` | Accept the one-time invitation token |
| `POST` | `/workspaces/invitations/:invitationId/accept` | Accept an invitation discovered for the signed-in verified email |
| `GET` | `/workspaces/:id/onboarding` | Load resumable onboarding state |
| `PATCH` | `/workspaces/:id/onboarding` | Advance onboarding with optimistic concurrency |
| `POST` | `/workspaces/:id/onboarding/complete` | Complete required onboarding |
| `POST` | `/internal/tenants` | Idempotently provision a tenant and first owner invitation |
| `GET` | `/internal/tenants/:externalTenantId` | Read safe provisioning/onboarding status |
| `POST` | `/internal/tenants/:externalTenantId/owner-invitation/resend` | Rotate the first owner token |
| `GET/POST` | `/workspaces/:id/integration-connections` | List or register provider connections |
| `PATCH` | `/workspaces/:id/integration-connections/:connectionId` | Update non-secret connection settings |
| `POST` | `/workspaces/:id/integration-connections/:connectionId/connect` | Queue provider connection or reconnection |
| `DELETE` | `/workspaces/:id/integration-connections/:connectionId` | Revoke a connection without deleting history |
| `GET` | `/workspaces/:id/audit-events` | Read keyset-paginated immutable audit history |
| `GET` | `/reference/currencies?locale=en-AE` | List globally supported ISO 4217 currencies and minor units |
| `GET` | `/reference/permissions` | List permissions available to custom roles |

The interactive contract is served at `/docs` when Business Core is running.

## Security invariants

1. Business Core connects as a non-owner, non-superuser PostgreSQL role.
2. Every tenant transaction sets `app.current_workspace_id` and `app.current_actor_id` locally.
3. Row-level policies hide records outside that workspace, even if an application query omits its tenant predicate.
4. Database triggers reject child-to-parent references across workspaces.
5. Database and service guards reject invalid or cyclic studio hierarchies.
6. Provider secrets are rejected from ordinary JSON configuration and will only be
   accepted by the future encrypted secret-store adapter.
7. All privileged mutations check explicit permissions and write audit plus outbox records in the same transaction.
8. The service fails during startup if production is configured with development/local
   authentication, demo seeding, or if any required OIDC verifier setting is missing.
9. OIDC identity claims require an explicit `email_verified: true`; a missing claim
   is rejected.
10. Active business-unit hierarchies cannot cross legal entities, use archived
    parents, form cycles, or leave active children under an archived parent.
11. Internal provisioning requires the service credential and an `Idempotency-Key`;
    replay responses never persist or repeat an invitation token in plaintext.
12. Invitation discovery is limited by RLS to the signed-in user's verified
    email, and invitation acceptance still validates that email under a row lock.
13. Onboarding transitions require an active membership, workspace-setting
    permission, monotonic completed steps, and optimistic concurrency.

## First-owner authentication and onboarding flow

```text
Internal portal
  -> POST /internal/tenants (service token + idempotency key)
  -> workspace, first legal entity, RBAC defaults, CRM defaults
  -> owner invitation + not_started onboarding

Owner follows invite
  -> POST /auth/invitations/activate (one-time invitation token + password)
  -> short access token + rotating opaque refresh session
  -> GET /me
  -> nextAction = start_onboarding or resume_onboarding
  -> PATCH onboarding steps
  -> POST onboarding/complete
  -> GET /me
  -> nextAction = enter_workspace
```

Business Core supports signed local authentication only outside production. Passwords
are salted with scrypt, opaque refresh tokens are stored only as SHA-256 hashes and
rotated on every use, replay revokes the full session family, and password reset revokes
all existing refresh sessions. The Next.js BFF keeps access and refresh tokens in
HttpOnly, Secure-in-production, SameSite cookies. Production remains OIDC-only; Business
Core verifies the provider bearer token and continues to own tenant authorization.

## Verification

Run the unit tests:

```bash
npm test --workspace @wodana/business-core
```

With Business Core running locally, run the full HTTP smoke test:

```bash
BUSINESS_CORE_URL=http://127.0.0.1:8000/api/v1 \
  npm run test:smoke --workspace @wodana/business-core
```

Run the internal provisioning through onboarding flow separately:

```bash
BUSINESS_CORE_URL=http://127.0.0.1:8000/api/v1 \
BUSINESS_CORE_INTERNAL_TOKEN=<local-internal-token> \
  npm run test:smoke:auth --workspace @wodana/business-core
```

Run the full local authentication lifecycle (provision, activate, sign in, refresh,
recover, reset, and sign out):

```bash
BUSINESS_CORE_URL=http://127.0.0.1:8000/api/v1 \
BUSINESS_CORE_INTERNAL_TOKEN=<local-internal-token> \
  npm run test:smoke:local-auth --workspace @wodana/business-core
```

The smoke test validates session bootstrap, organization lifecycle, invitation
rotation/cancellation/acceptance, concurrent one-time-token use, member and role
management, ownership transfer, concurrent last-owner and last-company protection,
stale-write rejection, multi-domain connection lifecycle, reconnect collisions,
archived-company reconnect rejection, secret rejection, archive and hierarchy
dependency checks, keyset pagination, cross-tenant read isolation, and cross-tenant
reference rejection. Swagger also exposes typed request and response schemas for
frontend client generation.
