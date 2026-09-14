# Customer accounts and independent organizations — 15 September 2026

## Locked behavior

- A new customer starts with one customer account and one default organization.
- An additional organization is a fully independent workspace, not a division inside the first
  workspace. Business data, membership, roles, subscriptions and settings do not cross that line.
- A customer-account owner or administrator requests an organization. Wodana approves or rejects
  it through the protected internal control plane.
- The customer-account organization limit is enforced in both the service and database. Approval
  can raise the limit explicitly but cannot silently reduce it.
- Users can discover and switch only to organizations where they are active workspace members.
  Account membership is grouping metadata and never grants business-data access.
- Existing workspaces are backfilled one-to-one. No tenants are merged and no business rows move.

## API contract

Authenticated customer routes:

- `GET /api/v1/workspaces/:workspaceId/account`
- `GET /api/v1/workspaces/:workspaceId/account/organization-requests`
- `POST /api/v1/workspaces/:workspaceId/account/organization-requests`
- `POST /api/v1/workspaces/:workspaceId/account/organization-requests/:requestId/cancel`

Protected Wodana control-plane routes:

- `GET /api/v1/internal/organization-requests`
- `GET /api/v1/internal/customer-accounts/:accountId`
- `POST /api/v1/internal/organization-requests/:requestId/approve`
- `POST /api/v1/internal/organization-requests/:requestId/reject`
- `PATCH /api/v1/internal/customer-accounts/:accountId/organization-limit`

The request, cancellation, review and limit responses use optimistic versions. Creation uses a
stable idempotency key. Approval provisions the workspace and links it to the account in the same
database transaction, so a partial organization cannot be exposed.

## Security invariants

- `customer_account_organizations.workspace_id` is globally unique.
- An account has at most one default organization.
- A database trigger prevents linking more organizations than the approved account limit.
- A database trigger rejects a request whose source or approved workspace belongs to another
  account.
- Active workspace members are synchronized to account membership for discovery; that membership
  does not bypass workspace row-level security or workspace-role checks.
- Account listings join active workspace membership and therefore omit organizations the user
  cannot enter.
- Internal review routes require `InternalServiceGuard`; customer routes require authenticated
  workspace and account access.

## Verification

`npm run test:smoke:customer-accounts --workspace @wodana/business-core` runs against an isolated
API/database and verifies default organization creation, idempotency, mutation rejection, no access
before approval, limit enforcement, atomic provisioning, replay safety, member discovery, one
default organization and cross-account denial.

The frontend account switcher, customer request screen and Wodana review screen are deliberately a
later UI slice. Their backend contracts are complete; onboarding and data-migration automation stay
in the final phase after the operational funnel is stable.
