# Tenant-isolation exceptions

Workspace-owned business tables use PostgreSQL row-level security. Five tables intentionally remain
outside RLS because the workspace is discovered from an untrusted public capability or a protected
cross-tenant worker request before a tenant transaction can be established.

| Table | Required boundary | Allowed use |
| --- | --- | --- |
| `tenant_provisioning_requests` | `InternalServiceGuard` | Internal tenant registry, provisioning idempotency and management lookup |
| `tenant_login_branding` | Public unique login slug for reads; workspace permission for writes | Resolve tenant login identity and public logo before authentication |
| `client_portal_settings` | Public unique portal slug, followed by OTP/session/grant validation | Resolve a client portal before entering its tenant transaction |
| `project_vendor_access` | 256-bit random capability token stored only as SHA-256, expiry, revocation and rate limit | Resolve the tenant for a restricted vendor order link |
| `commercial_reconciliation_jobs` | `InternalServiceGuard`, short lease token and expiry | Claim cross-tenant accounting jobs before processing each in a tenant transaction |

After discovery, business data must be read or written through `tenantTransaction` with the resolved
workspace. These exceptions may not be used for general business queries, reporting, or UI access.

Run the schema assertion against any migrated database:

```bash
MIGRATION_DATABASE_URL=postgresql:///database_name \
  npm run test:smoke:tenant-isolation --workspace @wodana/business-core
```

The assertion fails if a sixth workspace table is introduced without RLS. Changing the exception
list requires an explicit security review and an update to this document.
